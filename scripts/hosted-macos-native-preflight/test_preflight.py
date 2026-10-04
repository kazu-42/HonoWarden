"""Pure policy/transport tests: no native app, command, keychain, network or Worker."""

import base64
import hashlib
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import preflight as p
import launch


class FakeSocket:
    def __init__(self, frame=b""):
        self.data = bytearray(frame)
        self.sent = []

    def recv(self, count):
        value = bytes(self.data[:count])
        del self.data[:count]
        return value

    def sendall(self, data):
        self.sent.append(data)
        if data.startswith(b"GET "):
            key = data.split(b"Sec-WebSocket-Key: ", 1)[1].split(b"\r\n", 1)[0]
            accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            payload = json.dumps({"id": 1, "result": {"result": {"value": {"visibleDom": True, "appLoopback": True}}}}).encode()
            self.data.extend(b"HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n" + b"\x81" + bytes([len(payload)]) + payload)

    def settimeout(self, timeout):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class PolicyTests(unittest.TestCase):
    def test_effective_client_identity_is_exact_frozen_receipt_identity(self):
        canonical = json.dumps(p.effective_client_identity(), sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(),
                         "3dc9159a5645274281331a530265af7fb72fa2b9f6a32e338d2357ea75c1e068")
        self.assertEqual(p.ASSET_SHA, "8cb6badb3a8af77cc3e4b060fa14858cd7fd74be7360b1b6e98dde1afed409d2")
        self.assertEqual(p.ASSET_BYTES, 272075739)
        self.assertEqual(p.UNPACKED_BYTES, 774807395)

    def test_guest_env_drops_all_credentials_proxies_and_inspectors(self):
        env = p.safe_environment(Path("/owned"), {"PATH": "/usr/bin", "GITHUB_TOKEN": "must-never-leave",
                "CLOUDFLARE_API_TOKEN": "private", "NODE_OPTIONS": "--inspect", "HTTPS_PROXY": "private",
                "SSH_AUTH_SOCK": "/agent", "ELECTRON_RUN_AS_NODE": "1", "HOME": "/host"})
        self.assertEqual(set(env), {"PATH", "HOME", "TMPDIR", "LANG"})
        self.assertEqual(env["HOME"], "/owned/home")
        self.assertNotIn("private", str(env))

    def test_local_host_execution_guard(self):
        with patch.object(p.sys, "platform", "darwin"):
            with self.assertRaisesRegex(p.Blocked, "hosted_job_required"):
                p.hosted_context({})

    def test_self_hosted_runner_guard(self):
        with patch.object(p.sys, "platform", "darwin"):
            with self.assertRaisesRegex(p.Blocked, "fresh_hosted_vm_required"):
                p.hosted_context({"GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_ENVIRONMENT": "self-hosted"})

    def test_wrong_repository_guard(self):
        with patch.object(p.sys, "platform", "darwin"):
            with self.assertRaisesRegex(p.Blocked, "job_identity_mismatch"):
                p.hosted_context({"GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                                  "RUNNER_OS": "macOS", "GITHUB_REPOSITORY": "other/repository"})

    def test_exact_app_pid_listener(self):
        p.listener_owned(b"p42\nn127.0.0.1:8123\n", 42, 8123)

    def test_same_job_different_pid_cannot_admit_cdp(self):
        with self.assertRaisesRegex(p.Blocked, "identity_mismatch"):
            p.listener_owned(b"p41\nn127.0.0.1:8123\n", 42, 8123)

    def test_wildcard_listener_is_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "identity_mismatch"):
            p.listener_owned(b"p42\nn*:8123\n", 42, 8123)

    def test_missing_listener_is_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "listener_missing"):
            p.listener_owned(b"p42\n", 42, 8123)

    def test_sandbox_has_exact_loopback_exceptions(self):
        profile = p.sandbox_profile(8123, 8124)
        self.assertIn("(deny network-outbound)", profile)
        self.assertIn('remote tcp "127.0.0.1:8123"', profile)
        self.assertIn('local tcp "127.0.0.1:8124"', profile)
        self.assertNotIn("localhost:*", profile)

    def test_sandbox_ports_fail_closed(self):
        for first, second in [(8123, 8123), (1, 8123), (8123, 70000), (True, 8123), ("8123", 8124)]:
            with self.subTest(values=(first, second)), self.assertRaises(p.Blocked):
                p.sandbox_profile(first, second)

    def test_websocket_payload_bound_precedes_allocation(self):
        sock = FakeSocket(b"\x81\x7f" + struct.pack("!Q", p.CAP + 1))
        with self.assertRaisesRegex(p.Blocked, "frame_limit"):
            p.read_frame(sock)

    def test_masked_server_frame_is_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "frame_invalid"):
            p.read_frame(FakeSocket(b"\x81\x81"))

    def test_fragmented_frame_is_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "frame_invalid"):
            p.read_frame(FakeSocket(b"\x01\x00"))

    def test_closed_websocket_is_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "cdp_closed"):
            p.read_frame(FakeSocket())

    def test_websocket_accept_preserves_base64_case(self):
        sock = FakeSocket()
        with patch.object(p.socket, "create_connection", return_value=sock):
            result = p.cdp_probe("ws://127.0.0.1:8123/devtools/page/fixture", 8123, "({visibleDom:true})")
        self.assertEqual(result, {"visibleDom": True, "appLoopback": True})
        self.assertTrue(sock.sent[1][1] & 0x80)

    def test_foreign_websocket_endpoint_is_rejected(self):
        for url in ["ws://127.0.0.1:8124/devtools/page/id", "ws://example.com:8123/devtools/page/id",
                    "ws://127.0.0.1:8123/devtools/browser/id", "ws://user@127.0.0.1:8123/devtools/page/id",
                    "ws://127.0.0.1:8123/devtools/page/id?token=secret"]:
            with self.subTest(url=url), self.assertRaises(p.Blocked):
                p.cdp_probe(url, 8123, "({})")

    def test_no_authenticated_claim_allowed(self):
        with self.assertRaisesRegex(p.Blocked, "credential_claim_refused"):
            p.public_report({"authenticated": True, "credentialAdmission": False})

    def test_safe_report_does_not_accept_raw_fields(self):
        for key in ["stdout", "screenshot", "profile", "token", "email", "arguments", "environment"]:
            with self.subTest(key=key), self.assertRaisesRegex(p.Blocked, "unknown_field"):
                p.public_report({"authenticated": False, "credentialAdmission": False, key: "private"})

    def test_gui_projection_rejects_titles_and_bool_counts(self):
        gui = {"onConsole": True, "appWindowCount": 1, "accessibilityGranted": False, "screenCaptureGranted": False}
        p.public_report({"authenticated": False, "credentialAdmission": False, "gui": gui})
        with self.assertRaises(p.Blocked):
            p.public_report({"authenticated": False, "credentialAdmission": False, "gui": {**gui, "title": "private"}})
        with self.assertRaises(p.Blocked):
            p.public_report({"authenticated": False, "credentialAdmission": False, "gui": {**gui, "appWindowCount": True}})

    def test_asset_redirect_refuses_http_foreign_and_credentials(self):
        handler = p.AssetRedirects()
        for url in ["http://github.com/file", "https://foreign.example/file", "https://user:secret@github.com/file"]:
            with self.subTest(url=url), self.assertRaises(p.Blocked):
                handler.redirect_request(None, None, 302, "", {}, url)

    def test_keychain_projection_accepts_only_absolute_paths(self):
        self.assertEqual(p.parse_keychains(b'    "/guest/login.keychain-db"\n'), ["/guest/login.keychain-db"])
        with self.assertRaises(p.Blocked):
            p.parse_keychains(b'"relative"')

    def test_launch_gate_eof_never_admits_native_execution(self):
        stream = MagicMock()
        stream.fileno.return_value = 42
        with patch.object(launch.select, "select", return_value=([stream], [], [])), \
             patch.object(launch.os, "read", return_value=b""), patch.object(launch.os, "execve") as execute:
            self.assertFalse(launch.await_go(stream))
            execute.assert_not_called()

    def test_launch_gate_timeout_never_admits_native_execution(self):
        stream = MagicMock()
        with patch.object(launch.select, "select", return_value=([], [], [])), patch.object(launch.os, "read") as read:
            self.assertFalse(launch.await_go(stream))
            read.assert_not_called()

    def test_launch_gate_accepts_only_exact_public_go_line(self):
        stream = MagicMock()
        with patch.object(launch.select, "select", return_value=([stream], [], [])):
            for line in [b"GO\n", b"NO\n", b"GO\nx", b"private"]:
                with self.subTest(line=line), patch.object(launch.os, "read", return_value=line):
                    self.assertEqual(launch.await_go(stream), line == b"GO\n")

    def test_registry_is_durable_before_launch_go(self):
        calls = []
        proc = MagicMock(pid=42)
        proc.stdin.write.side_effect = lambda value: calls.append(("go", value))
        identity = {"uid": p.os.getuid(), "pgid": 42, "session": 42, "start": "Sun Oct 4 12:00:00 2026", "image": "Python"}
        state = {"children": []}
        with patch.object(p.subprocess, "Popen", return_value=proc), patch.object(p, "process_identity", return_value=identity), \
             patch.object(p, "update_private", side_effect=lambda *_: calls.append(("persist", None))), patch.object(p, "PROCESSES", []):
            p.gated_launch(["/node", "/owned/worker.mjs"], "worker", {}, state, Path("/marker"), None)
        self.assertEqual([call[0] for call in calls], ["persist", "go"])
        self.assertEqual(state["children"][0]["pid"], 42)

    def test_registry_write_failure_closes_launch_gate(self):
        proc = MagicMock(pid=42)
        identity = {"uid": p.os.getuid(), "pgid": 42, "session": 42, "start": "Sun Oct 4 12:00:00 2026", "image": "Python"}
        with patch.object(p.subprocess, "Popen", return_value=proc), patch.object(p, "process_identity", return_value=identity), \
             patch.object(p, "update_private", side_effect=p.Blocked("fixture_write_failure")), \
             patch.object(p, "stop_group") as stop, patch.object(p, "PROCESSES", []):
            with self.assertRaises(p.Blocked):
                p.gated_launch(["/node"], "worker", {}, {"children": []}, Path("/marker"), None)
        proc.stdin.write.assert_not_called()
        proc.stdin.close.assert_called_once()
        stop.assert_called_once_with(proc)

    def test_pid_reuse_start_identity_refuses_kill(self):
        row = {"pid": 42, "role": "worker", "uid": p.os.getuid(), "pgid": 42, "session": 42,
               "start": "old", "images": ["node"]}
        identity = {"uid": p.os.getuid(), "pgid": 42, "session": 42, "start": "new", "image": "/node"}
        with patch.object(p, "process_identity", return_value=identity), patch.object(p.os, "killpg") as kill:
            with self.assertRaisesRegex(p.Blocked, "identity_changed"):
                p.stop_recorded(row)
        kill.assert_not_called()

    def test_dead_leader_live_group_fails_closed_without_kill(self):
        row = {"pid": 42, "role": "worker", "uid": p.os.getuid(), "pgid": 42, "session": 42,
               "start": "old", "images": ["node"]}
        with patch.object(p, "process_identity", return_value=None), patch.object(p.os, "killpg") as kill:
            with self.assertRaisesRegex(p.Blocked, "without_live_leader"):
                p.stop_recorded(row)
        kill.assert_called_once_with(42, 0)

    def test_keychain_snapshot_failure_creates_no_owned_root(self):
        with patch.object(p, "marker_path", return_value=Path("/nonexistent-fixture-marker")), \
             patch.object(p, "command", side_effect=p.Blocked("fixture_read_failed")), \
             patch.object(p.tempfile, "mkdtemp") as create, patch.object(p, "STEP_END", p.time.monotonic() + 270):
            with self.assertRaises(p.Blocked):
                p.execute(Path("/fixture"), Path("/company"))
        create.assert_not_called()

    def test_marker_write_failure_removes_empty_test_root(self):
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            parent = Path(fixture)
            root = parent / "owned-test"
            root.mkdir(mode=0o700)
            with patch.object(p, "marker_path", return_value=parent / "marker.json"), \
                 patch.object(p, "command", return_value=(b'"/guest/original"\n', 0)), \
                 patch.object(p.tempfile, "mkdtemp", return_value=str(root)), \
                 patch.object(p, "write_private", side_effect=p.Blocked("fixture_write_failed")), \
                 patch.object(p, "STEP_END", p.time.monotonic() + 270):
                with self.assertRaises(p.Blocked):
                    p.execute(parent, Path("/company"))
            self.assertFalse(root.exists())

    def test_cleanup_attempts_independent_steps_with_three_second_bounds(self):
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            root = Path(fixture)
            owned = root / "owned.keychain-db"
            owned.touch()
            calls = []
            def fake_command(args, timeout=15, **kwargs):
                calls.append((args, timeout))
                if "default-keychain" in args and "-s" in args:
                    raise p.Blocked("fixture_restore_failure")
                if "delete-keychain" in args:
                    owned.unlink()
                return b'"/guest/original"\n', 0
            state = {"children": [], "priorDefault": "/guest/original", "priorSearch": ["/guest/original"]}
            with patch.object(p, "PROCESSES", []), patch.object(p, "command", side_effect=fake_command):
                failures = p.cleanup(root, state)
            self.assertIn("keychain_cleanup_failed", failures)
            self.assertEqual(len(calls), 5)
            self.assertTrue(all(timeout == 3 for _, timeout in calls))
            self.assertTrue(any("delete-keychain" in args for args, _ in calls))

    def test_interrupted_finisher_has_unknown_execution_and_exact_fixture_cleanup(self):
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            temp = Path(fixture)
            root = temp / "hw-macos-preflight-fixture"
            root.mkdir(mode=0o700)
            marker = temp / "marker.json"
            before = root.stat()
            state = {"root": str(root), "uid": p.os.getuid(), "dev": before.st_dev, "ino": before.st_ino,
                     "priorDefault": "/guest/original", "priorSearch": ["/guest/original"], "children": []}
            p.write_private(marker, state)
            output = io.StringIO()
            with patch.object(p, "marker_path", return_value=marker), patch.object(p, "cleanup", return_value=[]) as cleanup, \
                 patch.object(p, "command", return_value=(b"", 1)), patch.object(p.os, "environ", {}), \
                 patch.object(p.sys, "stdout", output):
                self.assertEqual(p.finish(temp), 0)
            report = json.loads(output.getvalue())
            self.assertIsNone(report["nativeExecuted"])
            self.assertFalse(report["authenticated"])
            self.assertTrue(report["cleanupComplete"])
            self.assertEqual(report["status"], "pre_auth_blocked")
            self.assertFalse(root.exists())
            self.assertFalse(marker.exists())
            cleanup.assert_called_once_with(root, state)

    def test_absolute_cli_lease_precedes_initial_guest_probe(self):
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            captured = []
            def initial_probe(*args, **kwargs):
                captured.append(p.STEP_END)
                raise p.Blocked("fixture_initial_probe_failure")
            with patch.object(p.sys, "argv", ["preflight.py", "--execute", "--company", fixture]), \
                 patch.object(p, "hosted_context", return_value=Path(fixture)), \
                 patch.object(p, "marker_path", return_value=Path(fixture) / "absent.json"), \
                 patch.object(p.time, "monotonic", return_value=1000), \
                 patch.object(p.signal, "signal"), patch.object(p.signal, "setitimer") as timer, \
                 patch.object(p.signal, "getsignal", return_value=None), \
                 patch.object(p, "command", side_effect=initial_probe):
                with self.assertRaisesRegex(p.Blocked, "fixture_initial_probe_failure"):
                    p.main()
            self.assertEqual(captured, [1270])
            self.assertEqual(timer.call_args_list[0].args, (p.signal.ITIMER_REAL, 270))

    def test_phase_deadlines_reserve_cleanup_and_never_extend_original_end(self):
        with patch.object(p.time, "monotonic", return_value=100):
            with self.assertRaisesRegex(p.Blocked, "exhausted"):
                p.phase_deadline(130, 220, reserve=30)
            self.assertEqual(p.phase_deadline(200, 220, reserve=30), 170)
        with patch.object(p.time, "monotonic", return_value=195):
            self.assertEqual(p.phase_deadline(200, 25), 200)

    def test_term_kill_waits_consume_only_remaining_absolute_budget(self):
        clock = {"now": 100.0}
        proc = MagicMock(pid=42)
        proc.poll.side_effect = [None, 0]
        proc.wait.side_effect = lambda timeout: clock.update(now=clock["now"] + timeout)
        with patch.object(p, "STEP_END", 100.25), patch.object(p.time, "monotonic", side_effect=lambda: clock["now"]), \
             patch.object(p.os, "killpg") as kill:
            p.stop_group(proc)
        self.assertEqual(proc.wait.call_count, 1)
        self.assertEqual(proc.wait.call_args.kwargs["timeout"], 0.25)
        self.assertEqual(clock["now"], 100.25)
        self.assertEqual(kill.call_count, 2)

    def test_expired_absolute_budget_refuses_new_command(self):
        with patch.object(p, "STEP_END", 99), patch.object(p.time, "monotonic", return_value=100), \
             patch.object(p.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(p.Blocked, "command_deadline"):
                p.command(["/never-executed"])
        spawn.assert_not_called()

    def test_expired_absolute_budget_refuses_finalization_write(self):
        with patch.object(p, "STEP_END", 99), patch.object(p.time, "monotonic", return_value=100), \
             patch("builtins.open") as open_file:
            with self.assertRaisesRegex(p.Blocked, "write_deadline"):
                p.write_private(Path("/never-written"), {})
        open_file.assert_not_called()

    def test_finish_cli_has_separate_absolute_ninety_second_lease(self):
        captured = []
        with patch.object(p.sys, "argv", ["preflight.py", "--finish"]), \
             patch.object(p, "hosted_context", return_value=Path("/fixture")), \
             patch.object(p.time, "monotonic", return_value=1000), \
             patch.object(p.signal, "signal"), patch.object(p.signal, "setitimer"), \
             patch.object(p.signal, "getsignal", return_value=None), \
             patch.object(p, "finish", side_effect=lambda *_: captured.append(p.STEP_END) or 0):
            self.assertEqual(p.main(), 0)
        self.assertEqual(captured, [1090])

    def test_readiness_retry_never_swallows_absolute_deadline_alarm(self):
        with patch.object(p.time, "sleep") as sleep:
            with self.assertRaisesRegex(p.Blocked, "absolute_step_deadline"):
                p.readiness_retry(p.Blocked("absolute_step_deadline"))
        sleep.assert_not_called()

    def test_readiness_retry_never_sleeps_after_shared_deadline(self):
        with patch.object(p, "STEP_END", 99), patch.object(p.time, "monotonic", return_value=100), \
             patch.object(p.time, "sleep") as sleep:
            with self.assertRaisesRegex(p.Blocked, "absolute_step_deadline"):
                p.readiness_retry(p.Blocked("cdp_listener_missing"))
        sleep.assert_not_called()

    def test_readiness_retry_sleep_uses_only_remaining_budget(self):
        clock = {"now": 100.0}
        def pause(seconds):
            clock["now"] += seconds
        with patch.object(p, "STEP_END", 100.125), patch.object(p.time, "monotonic", side_effect=lambda: clock["now"]), \
             patch.object(p.time, "sleep", side_effect=pause) as sleep:
            with self.assertRaisesRegex(p.Blocked, "absolute_step_deadline"):
                p.readiness_retry(p.Blocked("cdp_listener_missing"))
        sleep.assert_called_once_with(0.125)


if __name__ == "__main__":
    unittest.main()
