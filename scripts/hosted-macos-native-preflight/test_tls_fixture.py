import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import plistlib
import unittest
from unittest.mock import patch

import tls_fixture as tls


class TLSFixtureTests(unittest.TestCase):
    def root_and_certificate(self, parent):
        root = Path(parent)
        (root / "tls").mkdir(mode=0o700)
        tls.private_write(root / "tls/ca.pem", "fictional public certificate")
        return root, tls.digest_certificate(root)

    def record(self, digest):
        return {"schema": "honowarden-owned-tls-v1", "certificateSha256": digest,
                "baselineSha256": "b" * 64, "attempted": True}

    def test_host_machine_cannot_mutate_trust(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(tls, "generate") as generate:
            with self.assertRaisesRegex(tls.Blocked, "tls_hosted_guest_required"):
                tls.install(Path("/fictional"), Path("/fictional/owned.keychain-db"), None, None)
            with self.assertRaisesRegex(tls.Blocked, "tls_hosted_guest_required"):
                tls.restore(Path("/fictional"), {}, None)
            generate.assert_not_called()

    def test_uncertain_install_is_journaled_and_can_restore_only_its_own_ca(self):
        with tempfile.TemporaryDirectory() as parent:
            root, digest = self.root_and_certificate(parent)
            journal, calls = [], []
            def command(args, **kwargs):
                calls.append(args)
                self.assertEqual(len(journal), 1)
                if "add-trusted-cert" in args:
                    raise TimeoutError()
                return b"", 0
            with patch.object(tls, "hosted_only"), patch.object(tls, "generate", return_value=digest), \
                 patch.object(tls, "trust_digest", side_effect=["b" * 64, "c" * 64, "b" * 64, "b" * 64]):
                with self.assertRaisesRegex(tls.Blocked, "tls_install_command_failed"):
                    tls.install(root, root / "owned.keychain-db", command, journal.append)
                self.assertEqual(journal, [self.record(digest)])
                tls.restore(root, journal[0], command)
                tls.restore(root, journal[0], command)
            self.assertEqual(calls[0][-1], str(root / "tls/ca.pem"))
            self.assertIn("127.0.0.1", calls[0])
            self.assertNotIn("-e", calls[0])
            self.assertEqual(len(calls), 2)
            self.assertIn("remove-trusted-cert", calls[1])

    def test_already_restored_trust_is_not_removed_again(self):
        with tempfile.TemporaryDirectory() as parent:
            root, digest = self.root_and_certificate(parent)
            with patch.object(tls, "hosted_only"), patch.object(tls, "trust_digest", return_value="b" * 64), \
                 patch.object(tls, "generate") as command:
                tls.restore(root, self.record(digest), command)
                command.assert_not_called()

    def test_changed_certificate_and_foreign_record_cannot_remove_trust(self):
        with tempfile.TemporaryDirectory() as parent:
            root, digest = self.root_and_certificate(parent)
            with patch.object(tls, "hosted_only"), patch.object(tls, "trust_digest") as probe:
                with self.assertRaisesRegex(tls.Blocked, "tls_certificate_changed"):
                    tls.restore(root, self.record("a" * 64), None)
                with self.assertRaisesRegex(tls.Blocked, "tls_record_invalid"):
                    tls.restore(root, {**self.record(digest), "certificatePath": "/foreign"}, None)
                probe.assert_not_called()

    def test_installed_trust_probe_cannot_substitute_explicit_anchor_for_system_trust(self):
        calls = []
        def command(args, **kwargs):
            calls.append((args, kwargs))
            self.assertNotIn("-r", args)
            self.assertEqual(args.count("-c"), 2)
            self.assertIn("-L", args)
            return b"FICTIONAL_PRIVATE_DIAGNOSTIC", 0 if kwargs['env'] is None else 1
        with patch.object(tls, "hosted_only"):
            self.assertEqual(tls.verify_installed(Path('/fictional'), command, {'HOME': '/owned'}),
                             {'runner': True, 'isolated': False})
        self.assertEqual(len(calls), 2)

    def test_cleanup_command_errors_do_not_expose_arbitrary_error_messages(self):
        with tempfile.TemporaryDirectory() as parent:
            root, digest = self.root_and_certificate(parent)
            for detail, expected in [("command_deadline", "tls_remove_timeout"),
                                      ("process_group_term_permission_denied", "tls_remove_process_permission"),
                                      ("FICTIONAL_PRIVATE_OUTPUT", "tls_remove_command_failed")]:
                def command(*args, **kwargs):
                    raise RuntimeError(detail)
                with patch.object(tls, "hosted_only"), patch.object(tls, "trust_digest", return_value="c" * 64), \
                     self.assertRaisesRegex(tls.Blocked, "^" + expected + "$"):
                    tls.restore(root, self.record(digest), command)

    def test_trust_drift_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as parent:
            root, digest = self.root_and_certificate(parent)
            calls = []
            with patch.object(tls, "hosted_only"), patch.object(tls, "trust_digest", return_value="c" * 64):
                with self.assertRaisesRegex(tls.Blocked, "tls_trust_restore_mismatch"):
                    tls.restore(root, self.record(digest), lambda args, **_: (calls.append(args) or b"", 0))
            self.assertEqual(len(calls), 1)
            self.assertIn("remove-trusted-cert", calls[0])
            self.assertNotIn("trust-settings-import", calls[0])

    def test_missing_trust_requires_the_actual_absence_diagnostic(self):
        with tempfile.TemporaryDirectory() as parent:
            root, _ = self.root_and_certificate(parent)
            with self.assertRaisesRegex(tls.Blocked, "tls_trust_read_failed"):
                tls.trust_digest(root, lambda *a, **k: (b"Permission denied", 1), "before")
            self.assertEqual(tls.trust_digest(root, lambda *a, **k: (b"No Trust Settings were found", 1), "before"),
                             hashlib.sha256(b"absent-admin-trust-domain").hexdigest())

    def test_empty_restored_trust_domain_matches_absence_but_foreign_entries_do_not(self):
        with tempfile.TemporaryDirectory() as parent:
            root, _ = self.root_and_certificate(parent)
            def export(document):
                def command(args, **_):
                    self.assertEqual(args[:3], ["/usr/bin/security", "trust-settings-export", "-d"])
                    Path(args[-1]).write_bytes(plistlib.dumps(document))
                    return b"", 0
                return command
            expected = hashlib.sha256(b"absent-admin-trust-domain").hexdigest()
            self.assertEqual(tls.trust_digest(root, export({"trustVersion": 1, "trustList": {}}), "after"), expected)
            self.assertNotEqual(tls.trust_digest(root, export({"trustVersion": 1, "trustList": {"foreign": {}}}), "after"), expected)

    @unittest.skipUnless(Path("/usr/bin/openssl").is_file(), "system OpenSSL required")
    def test_actual_offline_ca_and_loopback_server_material(self):
        # No security/keychain/PF command is permitted by this runner.
        def command(args, timeout, **_):
            self.assertEqual(args[0], "/usr/bin/openssl")
            result = subprocess.run(args, capture_output=True, timeout=timeout,
                                    env={"PATH": "/usr/bin:/bin"})
            self.assertEqual(result.returncode, 0)
            return result.stdout, result.returncode
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent)
            digest = tls.generate(root, command)
            self.assertEqual(digest, tls.digest_certificate(root))
            self.assertEqual((root / "tls/chain.pem").read_bytes(),
                             (root / "tls/leaf.pem").read_bytes() + (root / "tls/ca.pem").read_bytes())
            for path in (root / "tls").iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            text, _ = command(["/usr/bin/openssl", "x509", "-in", str(root / "tls/leaf.pem"), "-noout", "-text"], 3)
            self.assertIn(b"IP Address:127.0.0.1", text)
            self.assertNotIn(b"DNS:", text)
            self.assertIn(b"TLS Web Server Authentication", text)

    @unittest.skipUnless(Path("/usr/bin/security").is_file(), "Apple Security verifier required")
    def test_actual_apple_ssl_policy_with_explicit_fixture_anchor_and_no_keychain_search(self):
        def command(args, timeout, **_):
            self.assertEqual(args[0], "/usr/bin/openssl")
            result = subprocess.run(args, capture_output=True, timeout=timeout)
            self.assertEqual(result.returncode, 0)
            return result.stdout, result.returncode
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent)
            tls.generate(root, command)
            # Pure evaluation: explicit public fixture root, no trust writes,
            # no host keychain search and no network issuer retrieval.
            for hostname, accepted in [("127.0.0.1", True), ("localhost", False)]:
                result = subprocess.run(["/usr/bin/security", "verify-cert", "-c", str(root / "tls/leaf.pem"),
                                         "-r", str(root / "tls/ca.pem"), "-p", "ssl", "-n", hostname, "-N", "-L"],
                                        capture_output=True, timeout=5)
                self.assertEqual(result.returncode == 0, accepted)


if __name__ == "__main__":
    unittest.main()
