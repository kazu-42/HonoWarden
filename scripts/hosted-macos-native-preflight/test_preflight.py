"""Pure policy/transport tests: no native app, command, keychain, network or Worker."""

import ast
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
             patch.object(p.os, "killpg", side_effect=[None, ProcessLookupError("private")]) as kill:
            p.stop_group(proc)
        self.assertEqual(proc.wait.call_count, 1)
        self.assertEqual(proc.wait.call_args.kwargs["timeout"], 0.25)
        self.assertEqual(clock["now"], 100.25)
        self.assertEqual(kill.call_count, 2)
        self.assertEqual(kill.call_args_list, [unittest.mock.call(42, p.signal.SIGTERM), unittest.mock.call(42, 0)])

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


class FailureProjectionTests(unittest.TestCase):
    def escaped_finalization(self, stage, report=None, written=None):
        tree = ast.parse((p.HERE / "preflight.py").read_text())
        execute = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "execute")
        main_try = next(n for n in execute.body if isinstance(n, ast.Try) and n.finalbody)
        fake_signal = MagicMock()
        fake_cleanup = MagicMock(return_value=[])
        fake_write = MagicMock()
        if written is not None:
            fake_write.side_effect = lambda _path, value: written.update(value)
        fake_phase = MagicMock(return_value=900)
        if stage in {"cleanup", "cleanup_and_restore"}:
            fake_cleanup.side_effect = RuntimeError("private-cleanup-output")
        if stage == "write":
            fake_write.side_effect = p.Blocked("write_deadline_exhausted")
        if stage in {"lease_restore", "cleanup_and_restore"}:
            fake_signal.signal.side_effect = OSError("private-lease-info")
        if stage == "phase":
            fake_phase.side_effect = p.Blocked("phase_deadline_exhausted")
        scope = {"report": report if report is not None else {
                            "status": "pre_auth_blocked", "code": "worker_readiness_failed", "failureKind": "blocked",
                            "nativeExecuted": False, "authenticated": False, "credentialAdmission": False},
                 "absolute_end": 1000, "STEP_END": 800, "root": Path("/owned"), "temp": Path("/owned"),
                 "marker": Path("/owned/marker.json"), "state": {}, "prior_term": None,
                 "phase_deadline": fake_phase, "time_budget": lambda maximum: maximum,
                 "signal": fake_signal, "cleanup": fake_cleanup, "write_private": fake_write,
                 "public_report": p.public_report, "apply_cleanup_result": p.apply_cleanup_result,
                 "FinalizationFailure": getattr(p, "FinalizationFailure", None),
                 "finalization_projection": getattr(p, "finalization_projection", None)}
        try:
            exec(compile(ast.fix_missing_locations(ast.Module(body=main_try.finalbody, type_ignores=[])),
                         "<pure-exact-finalization-control>", "exec"), scope)
        except Exception as error:
            return error
        self.fail("injected finalization failure did not fail")

    def test_escaped_cleanup_deadline_write_and_restore_keep_original_failure(self):
        for stage in ["cleanup", "write", "lease_restore", "phase", "cleanup_and_restore"]:
            with self.subTest(stage=stage):
                error = self.escaped_finalization(stage)
                self.assertIsInstance(error, p.FinalizationFailure)
                projected = p.escaped_error_projection(error)
                self.assertEqual(projected["code"], "worker_readiness_failed")
                self.assertEqual(projected["failureKind"], "blocked")
                self.assertEqual(projected["status"], "cleanup_failed")
                self.assertFalse(projected["cleanupComplete"])
                self.assertFalse(projected["authenticated"])
                self.assertFalse(projected["credentialAdmission"])
                self.assertEqual(len(projected["cleanupFailureCodes"]), 2 if stage == "cleanup_and_restore" else 1)
                self.assertNotIn("private", json.dumps(projected))

    def test_outer_error_projection_keeps_carried_cause_and_fixed_secondary_code(self):
        report = {"code": "worker_readiness_failed", "failureKind": "blocked", "nativeExecuted": False}
        error = p.FinalizationFailure(p.finalization_projection(report, PermissionError("private")))
        result = p.escaped_error_projection(error)
        self.assertEqual(result["code"], report["code"])
        self.assertEqual(result["cleanupFailureCodes"], ["cleanup_finalization_permission_denied"])
        self.assertEqual(result["status"], "cleanup_failed")
        self.assertFalse(result["cleanupComplete"])

    def test_escaped_cleanup_without_body_error_still_has_a_fixed_primary_failure(self):
        result = p.finalization_projection({"nativeExecuted": False}, p.Blocked("write_deadline_exhausted"))
        self.assertEqual(result["code"], "write_deadline_exhausted")
        self.assertEqual(result["status"], "cleanup_failed")
        self.assertFalse(result["credentialAdmission"])

    def test_escaped_projection_refuses_raw_original_code(self):
        with self.assertRaises(p.Blocked):
            p.finalization_projection({"code": "/private/raw-exception", "failureKind": "blocked"}, OSError("private"))

    def test_carried_exception_projection_has_only_typed_minimal_failure_fields(self):
        base = p.finalization_projection({"code": "worker_readiness_failed", "failureKind": "blocked"}, OSError("private"))
        for extra in [{"osVersion": "private"}, {"nativeExecuted": "private"}, {"schemaVersion": True},
                      {"status": "pre_auth_capability_passed"}, {"cleanupComplete": True}]:
            with self.subTest(extra=extra), self.assertRaises(p.Blocked):
                p.FinalizationFailure({**base, **extra})

    def test_carried_projection_views_cannot_mutate_retained_failure(self):
        original = p.finalization_projection({"code": "worker_readiness_failed", "failureKind": "blocked"}, OSError("private"))
        error = p.FinalizationFailure(original)
        view = error.projection
        view["osVersion"] = "private"
        view["status"] = "pre_auth_capability_passed"
        view["cleanupFailureCodes"].append("keychain_cleanup_failed")
        self.assertEqual(p.escaped_error_projection(error), original)
        with self.assertRaises(AttributeError):
            error.projection = original

    def test_returned_cleanup_codes_do_not_alias_carried_exception(self):
        error = p.FinalizationFailure(p.finalization_projection({"code": "worker_readiness_failed"}, OSError("private")))
        first = p.escaped_error_projection(error)
        first["cleanupFailureCodes"].append("keychain_cleanup_failed")
        second = p.escaped_error_projection(error)
        self.assertEqual(second["cleanupFailureCodes"], ["cleanup_finalization_failed"])
        self.assertIsNot(first["cleanupFailureCodes"], second["cleanupFailureCodes"])

    def test_retained_failure_storage_is_immutable(self):
        error = p.FinalizationFailure(p.finalization_projection({"code": "worker_readiness_failed"}, OSError("private")))
        with self.assertRaises(TypeError):
            error._projection["status"] = "pre_auth_capability_passed"
        self.assertIs(type(error._projection["cleanupFailureCodes"]), tuple)

    def test_every_carried_read_refuses_replaced_invalid_storage(self):
        original = p.finalization_projection({"code": "worker_readiness_failed"}, OSError("private"))
        for delta in [{"osVersion": "private"}, {"status": "pre_auth_capability_passed"},
                      {"cleanupComplete": True}, {"cleanupFailureCodes": ("private",)}]:
            with self.subTest(delta=delta):
                error = p.FinalizationFailure(original)
                error._projection = {**original, "cleanupFailureCodes": tuple(original["cleanupFailureCodes"]), **delta}
                with self.assertRaises(p.Blocked):
                    p.escaped_error_projection(error)

    def test_successful_body_restore_failure_cannot_publish_stale_passed_checkpoint(self):
        saved = {}
        error = self.escaped_finalization("lease_restore", report={
            "schemaVersion": 1, "status": "pre_auth_capability_passed", "nativeExecuted": True,
            "authenticated": False, "credentialAdmission": False}, written=saved)
        self.assertEqual(p.escaped_error_projection(error)["status"], "cleanup_failed")
        self.assertEqual(saved["status"], "pre_auth_capability_passed")
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            temp = Path(fixture)
            root = temp / "hw-macos-preflight-fixture"
            root.mkdir(mode=0o700)
            marker = temp / "marker.json"
            before = root.stat()
            p.write_private(marker, {"root": str(root), "uid": p.os.getuid(), "dev": before.st_dev, "ino": before.st_ino,
                                     "priorDefault": "/guest/original", "priorSearch": ["/guest/original"], "children": []})
            p.write_private(temp / "marker-safe.json", saved)
            output = io.StringIO()
            with patch.object(p, "marker_path", return_value=marker), patch.object(p, "cleanup", return_value=[]), \
                 patch.object(p, "command", return_value=(b"", 1)), patch.object(p.sys, "stdout", output), \
                 patch.object(p.os, "environ", {"PREFLIGHT_EXECUTE_OUTCOME": "failure"}):
                self.assertEqual(p.finish(temp), 1)
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], "cleanup_failed")
            self.assertEqual(result["code"], "execute_finalization_unproved")
            self.assertTrue(result["cleanupComplete"])
            self.assertTrue(result["nativeExecuted"])
            self.assertFalse(result["credentialAdmission"])
            self.assertFalse(root.exists())

    def test_actual_execute_outcome_gate_never_promotes_failed_or_unknown_process(self):
        for outcome in ["failure", "cancelled", "skipped", "unknown"]:
            report = {"status": "pre_auth_capability_passed", "nativeExecuted": True,
                      "authenticated": False, "credentialAdmission": False}
            with self.subTest(outcome=outcome):
                p.apply_execute_outcome(report, outcome)
                self.assertEqual(report["status"], "cleanup_failed")
                self.assertEqual(report["code"], "execute_finalization_unproved")
                self.assertFalse(report["cleanupComplete"])
        report = {"status": "pre_auth_capability_passed", "authenticated": False, "credentialAdmission": False}
        p.apply_execute_outcome(report, "success")
        self.assertEqual(report["status"], "pre_auth_capability_passed")
        for invalid in ["private", True, [], None]:
            with self.subTest(invalid=invalid), self.assertRaises(p.Blocked):
                p.apply_execute_outcome(report, invalid)

    def test_actual_execute_outcome_keeps_known_primary_failure(self):
        report = {"status": "cleanup_failed", "code": "worker_readiness_failed", "failureKind": "blocked",
                  "cleanupFailureCodes": ["process_cleanup_failed"], "authenticated": False, "credentialAdmission": False}
        p.apply_execute_outcome(report, "failure")
        self.assertEqual(report["code"], "worker_readiness_failed")
        self.assertEqual(report["cleanupFailureCodes"], ["process_cleanup_failed"])

    def test_outer_absolute_lease_failure_cannot_replace_carried_first_body_error(self):
        @p.contextlib.contextmanager
        def failed_restore(seconds):
            try:
                yield
            finally:
                raise OSError("private-outer-lease-info")
        projection = p.finalization_projection({"code": "worker_readiness_failed", "failureKind": "blocked"},
                                             p.Blocked("write_deadline_exhausted"))
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            with patch.object(p.sys, "argv", ["preflight.py", "--execute", "--company", fixture]), \
                 patch.object(p, "hosted_context", return_value=Path(fixture)), \
                 patch.object(p, "absolute_step_lease", failed_restore), \
                 patch.object(p, "execute", side_effect=p.FinalizationFailure(projection)):
                with self.assertRaises(p.FinalizationFailure) as caught:
                    p.main()
        result = p.escaped_error_projection(caught.exception)
        self.assertEqual(result["code"], "worker_readiness_failed")
        self.assertEqual(len(result["cleanupFailureCodes"]), 2)
        self.assertEqual(result["status"], "cleanup_failed")
        self.assertFalse(result["cleanupComplete"])
        self.assertNotIn("private", json.dumps(result))

    def test_cleanup_failure_preserves_first_body_failure(self):
        report = {"status": "pre_auth_blocked", "code": "worker_readiness_failed",
                  "failureKind": "blocked", "authenticated": False, "credentialAdmission": False}
        p.apply_cleanup_result(report, ["process_cleanup_failed"])
        self.assertEqual(report["code"], "worker_readiness_failed")
        self.assertEqual(report["status"], "cleanup_failed")
        self.assertEqual(report["cleanupFailureCodes"], ["process_cleanup_failed"])
        self.assertFalse(report["cleanupComplete"])
        p.public_report(report)

    def test_cleanup_only_failure_has_a_primary_code(self):
        report = {"status": "pre_auth_capability_passed", "authenticated": False, "credentialAdmission": False}
        p.apply_cleanup_result(report, ["owned_process_identity_changed"])
        self.assertEqual(report["code"], "owned_process_identity_changed")
        self.assertEqual(report["status"], "cleanup_failed")
        self.assertFalse(report["cleanupComplete"])

    def test_successful_cleanup_keeps_body_failure_and_admission_unchanged(self):
        report = {"status": "pre_auth_blocked", "code": "worker_readiness_failed",
                  "authenticated": False, "credentialAdmission": False}
        p.apply_cleanup_result(report, [])
        self.assertEqual(report["code"], "worker_readiness_failed")
        self.assertEqual(report["status"], "pre_auth_blocked")
        self.assertNotIn("cleanupFailureCodes", report)
        self.assertFalse(report["cleanupComplete"])
        self.assertFalse(report["credentialAdmission"])

    def test_cleanup_projection_refuses_arbitrary_raw_values_and_unbounded_lists(self):
        for values in [["/private/keychain"], ["process_cleanup_failed"] * 17, "process_cleanup_failed", [True]]:
            with self.subTest(values=values), self.assertRaises(p.Blocked):
                p.apply_cleanup_result({"status": "pre_auth_blocked"}, values)

    def test_public_projection_accepts_only_closed_failure_kinds_and_cleanup_codes(self):
        base = {"authenticated": False, "credentialAdmission": False}
        p.public_report({**base, "failureKind": "attribute_error", "cleanupFailureCodes": ["process_cleanup_api_unavailable"]})
        for extra in [{"failureKind": "raw-private-exception"}, {"failureKind": True}, {"failureKind": []},
                      {"cleanupFailureCodes": ["/private/keychain"]},
                      {"cleanupFailureCodes": ["process_cleanup_failed"] * 17}, {"cleanupFailureCodes": "private"}]:
            with self.subTest(extra=extra), self.assertRaises(p.Blocked):
                p.public_report({**base, **extra})

    def test_exception_kinds_never_copy_exception_messages_or_arguments(self):
        cases = [(p.Blocked("private"), "blocked"), (AttributeError("private"), "attribute_error"),
                 (PermissionError("private"), "permission_error"), (TimeoutError("private"), "timeout"),
                 (p.subprocess.TimeoutExpired(["private-argument"], 2, output=b"private-environment"), "subprocess_timeout"),
                 (ValueError("private"), "value_error"), (OSError("private"), "os_error"),
                 (RuntimeError("private"), "unknown_exception")]
        for error, expected in cases:
            with self.subTest(expected=expected):
                value = p.failure_kind(error)
                self.assertEqual(value, expected)
                self.assertNotIn("private", value)

    def test_process_cleanup_reason_is_fixed_and_unknown_blocked_text_is_discarded(self):
        cases = [(p.Blocked("owned_group_without_live_leader"), "owned_group_without_live_leader"),
                 (p.Blocked("private"), "process_cleanup_failed"),
                 (AttributeError("private"), "process_cleanup_api_unavailable"),
                 (PermissionError("private"), "process_cleanup_permission_denied"),
                 (p.subprocess.TimeoutExpired(["private"], 2), "process_cleanup_timeout")]
        for error, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(p.process_cleanup_code(error, "process_cleanup_failed"), expected)

    def test_process_permission_boundary_keeps_only_a_closed_operation(self):
        for operation in p.PROCESS_PERMISSION_CODES:
            failure = MagicMock(side_effect=PermissionError("private-process-argument"))
            with self.subTest(operation=operation), self.assertRaises(p.Blocked) as caught:
                p.process_permission_call(operation, failure)
            self.assertEqual(str(caught.exception), operation)
            self.assertEqual(p.process_cleanup_code(caught.exception, "process_cleanup_failed"), operation)
        call = MagicMock()
        with self.assertRaises(p.Blocked):
            p.process_permission_call("private-operation", call)
        call.assert_not_called()

    def test_process_permission_boundary_does_not_swallow_or_reclassify_other_errors(self):
        for error in [ProcessLookupError("private"), TimeoutError("private"), p.Blocked("absolute_step_deadline")]:
            with self.subTest(category=type(error).__name__), self.assertRaises(type(error)) as caught:
                p.process_permission_call("process_group_probe_permission_denied", MagicMock(side_effect=error))
            self.assertIs(caught.exception, error)

    def test_group_cleanup_permission_code_identifies_term_or_kill(self):
        for running, operation in [(True, "process_group_term_permission_denied"),
                                   (False, "process_group_kill_permission_denied")]:
            proc = MagicMock(pid=123)
            proc.poll.return_value = None
            with self.subTest(running=running), patch.object(p.os, "killpg", side_effect=PermissionError("private")), \
                 self.assertRaises(p.Blocked) as caught:
                if running:
                    p.stop_group(proc)
                else:
                    with patch.object(p.os, "killpg", side_effect=[None, PermissionError("private")]), \
                         patch.object(proc, "wait", side_effect=p.subprocess.TimeoutExpired(["private"], 2)):
                        p.stop_group(proc)
            self.assertEqual(str(caught.exception), operation)

    def test_reaped_original_leader_absent_group_never_receives_destructive_signal(self):
        proc = MagicMock(pid=123)
        proc.poll.return_value = 1
        with patch.object(p.os, "killpg", side_effect=ProcessLookupError("private")) as signals:
            p.stop_group(proc)
        signals.assert_called_once_with(123, 0)
        proc.wait.assert_not_called()

    def test_reaped_original_leader_live_group_blocks_without_term_or_kill(self):
        proc = MagicMock(pid=123)
        proc.poll.return_value = 1
        with patch.object(p.os, "killpg") as signals, self.assertRaises(p.Blocked) as caught:
            p.stop_group(proc)
        self.assertEqual(str(caught.exception), "owned_group_without_live_leader")
        signals.assert_called_once_with(123, 0)

    def test_leader_reaped_during_term_wait_is_rechecked_before_kill(self):
        for gone in [True, False]:
            proc = MagicMock(pid=123)
            proc.poll.side_effect = [None, 1]
            calls = [None, ProcessLookupError("private") if gone else None]
            with self.subTest(groupGone=gone), patch.object(p.os, "killpg", side_effect=calls) as signals:
                if gone:
                    p.stop_group(proc)
                else:
                    with self.assertRaises(p.Blocked) as caught:
                        p.stop_group(proc)
                    self.assertEqual(str(caught.exception), "owned_group_without_live_leader")
            self.assertEqual(signals.call_args_list, [unittest.mock.call(123, p.signal.SIGTERM), unittest.mock.call(123, 0)])

    def test_unreaped_original_child_can_escalate_with_existing_wait_bounds(self):
        proc = MagicMock(pid=123)
        proc.poll.side_effect = [None, None, 1]
        proc.wait.side_effect = [p.subprocess.TimeoutExpired(["private"], 2), 1]
        with patch.object(p.os, "killpg", side_effect=[None, None, ProcessLookupError("private")]) as signals, \
             patch.object(p, "STEP_END", None):
            p.stop_group(proc)
        self.assertEqual(signals.call_args_list, [unittest.mock.call(123, p.signal.SIGTERM),
                                                 unittest.mock.call(123, p.signal.SIGKILL), unittest.mock.call(123, 0)])
        self.assertEqual(proc.wait.call_args_list, [unittest.mock.call(timeout=2), unittest.mock.call(timeout=2)])

    def test_reaped_leader_group_permission_failure_never_counts_as_absence(self):
        proc = MagicMock(pid=123)
        proc.poll.return_value = 1
        with patch.object(p.os, "killpg", side_effect=PermissionError("private")) as signals, \
             self.assertRaises(p.Blocked) as caught:
            p.stop_group(proc)
        self.assertEqual(str(caught.exception), "process_group_probe_permission_denied")
        signals.assert_called_once_with(123, 0)

    def test_killed_leader_with_remaining_group_is_still_unproved(self):
        proc = MagicMock(pid=123)
        proc.poll.side_effect = [None, None, 1]
        proc.wait.side_effect = [p.subprocess.TimeoutExpired(["private"], 2), 1]
        with patch.object(p.os, "killpg") as signals, self.assertRaises(p.Blocked) as caught:
            p.stop_group(proc)
        self.assertEqual(str(caught.exception), "owned_group_without_live_leader")
        self.assertEqual(signals.call_args_list, [unittest.mock.call(123, p.signal.SIGTERM),
                                                 unittest.mock.call(123, p.signal.SIGKILL), unittest.mock.call(123, 0)])

    def test_unknown_child_poll_state_never_admits_destructive_signal(self):
        for result in [True, "private", object()]:
            proc = MagicMock(pid=123)
            proc.poll.return_value = result
            with self.subTest(category=type(result).__name__), patch.object(p.os, "killpg") as signals, \
                 self.assertRaises(p.Blocked) as caught:
                p.stop_group(proc)
            self.assertEqual(str(caught.exception), "owned_process_projection_invalid")
            signals.assert_not_called()

    def test_recorded_cleanup_permission_code_identifies_group_probe(self):
        row = {"pid": 123, "role": "worker", "uid": p.os.getuid(), "pgid": 123, "session": 123,
               "start": "public-start", "images": ["node"]}
        with patch.object(p, "process_identity", return_value=None), \
             patch.object(p.os, "killpg", side_effect=PermissionError("private")), self.assertRaises(p.Blocked) as caught:
            p.stop_recorded(row)
        self.assertEqual(str(caught.exception), "process_group_probe_permission_denied")

    def test_process_permission_codes_remain_failed_closed_through_finalization(self):
        for operation in p.PROCESS_PERMISSION_CODES:
            report = {"code": "worker_readiness_failed", "failureKind": "blocked"}
            p.apply_cleanup_result(report, [operation])
            projected = p.escaped_error_projection(p.FinalizationFailure(p.finalization_projection(report, OSError("private"))))
            self.assertEqual(projected["code"], "worker_readiness_failed")
            self.assertEqual(projected["status"], "cleanup_failed")
            self.assertFalse(projected["cleanupComplete"])
            self.assertFalse(projected["credentialAdmission"])
            self.assertEqual(projected["cleanupFailureCodes"][0], operation)


class WorkerReadinessTests(unittest.TestCase):
    def test_exact_worker_producer_reports_mocked_startup_phase_without_error_bytes(self):
        # Every SDK resolves inside this tiny fixture; no real runtime or socket is created.
        with tempfile.TemporaryDirectory(dir=p.HERE) as fixture:
            root = Path(fixture)
            company, owned = root / "company", root / "owned"
            company.mkdir(mode=0o700)
            owned.mkdir(mode=0o700)
            def write(relative, text):
                path = company / relative
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                path.write_text(text)
                path.chmod(0o600)
            write("package.json", '{}')
            write("node_modules/wrangler/package.json", '{"name":"wrangler"}')
            write("node_modules/esbuild/package.json", '{"name":"esbuild","main":"index.cjs"}')
            write("node_modules/miniflare/package.json", '{"name":"miniflare","main":"index.cjs"}')
            write("scripts/honowarden-company-admin-smoke.mjs", """
if (process.env.FAKE_STAGE === 'dependency_import') throw new TypeError('private');
export const migrationStatements = () => ['SELECT 1'];
""")
            write("migrations/0030_fixture.sql", 'SELECT 1;')
            write("node_modules/esbuild/index.cjs", """
exports.build = async () => {
  if (process.env.FAKE_STAGE === 'build') {
    const types = {type_error: TypeError, range_error: RangeError, syntax_error: SyntaxError,
      reference_error: ReferenceError, error: Error};
    if (process.env.FAKE_KIND === 'unknown_exception') throw 'private';
    throw new (types[process.env.FAKE_KIND] || TypeError)('private');
  }
};
""")
            write("node_modules/miniflare/index.cjs", """
const fail = (phase) => { if (process.env.FAKE_STAGE === phase) throw new TypeError('private'); };
exports.Log = class {};
exports.LogLevel = {NONE: 0};
exports.MiniflareCoreError = class extends Error { constructor(code) { super('private'); this.code = code; } };
exports.Miniflare = class {
  constructor() { fail('runtime_construct'); }
  get ready() {
    if (process.env.FAKE_STAGE === 'runtime_ready') {
      const kind = process.env.FAKE_KIND;
      if (kind === 'miniflare_runtime_failure') throw new exports.MiniflareCoreError('ERR_RUNTIME_FAILURE');
      if (kind === 'miniflare_address_in_use') throw new exports.MiniflareCoreError('ERR_ADDRESS_IN_USE');
      if (kind === 'sdk_unknown') throw new exports.MiniflareCoreError('private-code');
      if (kind === 'foreign_known') { const error = new Error('private'); error.code = 'ERR_RUNTIME_FAILURE'; throw error; }
      if (kind === 'sdk_getter') { const error = new exports.MiniflareCoreError('unused');
        Object.defineProperty(error, 'code', {get() { throw new Error('private-getter-invoked'); }}); throw error; }
      if (kind === 'sdk_inherited') { const error = new exports.MiniflareCoreError('unused');
        delete error.code; Object.setPrototypeOf(error, new exports.MiniflareCoreError('ERR_RUNTIME_FAILURE')); throw error; }
      fail('runtime_ready');
    }
    return Promise.resolve(new URL(process.env.FAKE_STAGE === 'runtime_loopback_validate'
      ? 'http://localhost:8123/' : 'http://127.0.0.1:8123/'));
  }
  async getD1Database() { return {prepare: () => ({
    run: async () => { fail('d1_migrate'); },
    all: async () => { fail('d1_probe'); return {results: [{version: 30}]}; }
  })}; }
  async getR2Bucket() { fail('r2_probe'); return {
    put: async () => {}, get: async () => ({text: async () => 'synthetic-public-probe'}), delete: async () => {}
  }; }
  async dispatchFetch() { fail('http_probe'); return {ok: true, json: async () => ({name: 'HonoWarden'})}; }
  async dispose() {}
};
""")
            cases = [(phase, "type_error") for phase in ["module_setup", "dependency_import", "build", "runtime_construct",
                                                       "runtime_ready", "d1_migrate", "d1_probe", "r2_probe", "http_probe"]]
            cases += [("build", kind) for kind in ["range_error", "syntax_error", "reference_error", "error", "unknown_exception"]]
            cases += [("runtime_ready", kind) for kind in ["miniflare_runtime_failure", "miniflare_address_in_use",
                                                           "sdk_unknown", "foreign_known", "sdk_getter", "sdk_inherited"]]
            cases += [("runtime_loopback_validate", "error")]
            for phase, kind in cases + [("success", None), ("state_prepare", "error")]:
                with self.subTest(phase=phase, kind=kind):
                    if (owned / "state").is_dir():
                        p.shutil.rmtree(owned / "state")
                    if phase == "state_prepare":
                        (owned / "state").touch(mode=0o600)
                    args = ["node", str(p.HERE / "worker.mjs")]
                    if phase != "module_setup":
                        args += [str(company), str(owned)]
                    result = p.subprocess.run(args, env={"PATH": p.os.environ["PATH"], "FAKE_STAGE": phase,
                                                        "FAKE_KIND": kind or "error"}, capture_output=True, timeout=5)
                    self.assertLessEqual(len(result.stdout), 1024)
                    self.assertEqual(result.stderr, b"")
                    self.assertNotIn(b"private", result.stdout)
                    frame = json.loads(result.stdout)
                    if phase == "success":
                        self.assertEqual(result.returncode, 0)
                        self.assertEqual(frame, {"port": 8123, "d1": True, "r2": True, "worker": True})
                    else:
                        self.assertEqual(result.returncode, 1)
                        expected_kind = "error" if kind in {"sdk_unknown", "foreign_known", "sdk_getter", "sdk_inherited"} else kind
                        self.assertEqual(frame, {"phase": phase, "kind": expected_kind})

    def test_sdk_runtime_kinds_and_loopback_phase_are_closed_and_preserved(self):
        for phase, kind in [("runtime_ready", "miniflare_runtime_failure"),
                            ("runtime_ready", "miniflare_address_in_use"), ("runtime_loopback_validate", "error")]:
            frame = json.dumps({"phase": phase, "kind": kind}).encode() + b"\n"
            value, report, code = self.read([frame, b""], exited=1)
            self.assertIsNone(value)
            self.assertEqual(code, "worker_readiness_failed")
            self.assertEqual(report["workerFailurePhase"], phase)
            self.assertEqual(report["workerFailureKind"], kind)
            projected = p.escaped_error_projection(p.FinalizationFailure(p.finalization_projection(
                {**report, "code": code, "failureKind": "blocked"}, PermissionError("private"))))
            self.assertEqual(projected["workerFailurePhase"], phase)
            self.assertEqual(projected["workerFailureKind"], kind)
            self.assertFalse(projected["credentialAdmission"])

    def read(self, chunks, exited=None):
        worker = MagicMock()
        worker.poll.return_value = exited
        worker.stdout.fileno.return_value = 42
        report = {"authenticated": False, "credentialAdmission": False}
        with patch.object(p.time, "monotonic", return_value=100), patch.object(p, "STEP_END", 300), \
             patch.object(p.select, "select", return_value=([worker.stdout], [], [])), \
             patch.object(p.os, "read", side_effect=chunks):
            try:
                value = p.read_worker_readiness(worker, report)
                return value, report, None
            except p.Blocked as error:
                return None, report, str(error)

    def test_fragmented_success_requires_live_child_and_typed_loopback_port(self):
        frame = b'{"port":8123,"d1":true,"r2":true,"worker":true}\n'
        value, report, error = self.read([frame[:12], frame[12:]])
        self.assertIsNone(error)
        self.assertEqual(value["port"], 8123)
        self.assertNotIn("workerFailurePhase", report)
        _, report, error = self.read([frame], exited=0)
        self.assertEqual(error, "worker_success_child_exited")
        self.assertNotIn("workerFailurePhase", report)

    def test_buffered_terminal_failure_is_drained_after_child_exit(self):
        frame = b'{"phase":"dependency_import","kind":"type_error"}\n'
        value, report, error = self.read([frame[:15], frame[15:], b""], exited=1)
        self.assertIsNone(value)
        self.assertEqual(error, "worker_readiness_failed")
        self.assertEqual(report["workerFailurePhase"], "dependency_import")
        self.assertEqual(report["workerFailureKind"], "type_error")
        self.assertNotIn("workerReady", report)
        self.assertFalse(report["credentialAdmission"])

    def test_exit_after_empty_select_rechecks_newly_buffered_terminal_diagnostic(self):
        worker = MagicMock()
        worker.poll.return_value = 1
        worker.stdout.fileno.return_value = 42
        report = {}
        with patch.object(p.time, "monotonic", return_value=100), patch.object(p, "STEP_END", 300), \
             patch.object(p.select, "select", side_effect=[([], [], []), ([worker.stdout], [], []), ([worker.stdout], [], [])]) as select, \
             patch.object(p.os, "read", side_effect=[b'{"phase":"dependency_import","kind":"type_error"}\n', b""]):
            with self.assertRaisesRegex(p.Blocked, "^worker_readiness_failed$"):
                p.read_worker_readiness(worker, report)
        self.assertEqual(report, {"workerFailurePhase": "dependency_import", "workerFailureKind": "type_error"})
        self.assertEqual(select.call_args_list[1].args[3], 0)

    def test_exit_recheck_without_buffered_frame_keeps_phase_unknown(self):
        worker = MagicMock()
        worker.poll.return_value = 1
        report = {}
        with patch.object(p.time, "monotonic", return_value=100), patch.object(p, "STEP_END", 300), \
             patch.object(p.select, "select", return_value=([], [], [])), patch.object(p.os, "read") as read:
            with self.assertRaisesRegex(p.Blocked, "^worker_exited_without_readiness$"):
                p.read_worker_readiness(worker, report)
        self.assertEqual(report, {})
        read.assert_not_called()

    def test_eof_without_frame_keeps_startup_phase_unknown(self):
        _, report, error = self.read([b""], exited=1)
        self.assertEqual(error, "worker_readiness_eof")
        self.assertNotIn("workerFailurePhase", report)

    def test_invalid_duplicate_trailing_and_multiple_frames_are_rejected(self):
        invalid = [b'{"phase":"dependency_import","kind":"private"}\n',
                   b'{"phase":"private","kind":"error"}\n',
                   b'{"phase":"dependency_import","kind":"error","kind":"error"}\n',
                   b'{"phase":"dependency_import","kind":"error"}\nprivate',
                   b'{"phase":"dependency_import","kind":"error","message":"private"}\n',
                   b'{"phase":"dependency_import","kind":"error"}\n{}\n', b'\xff\n',
                   b'{"port":true,"d1":true,"r2":true,"worker":true}\n',
                   b'{"port":80,"d1":true,"r2":true,"worker":true}\n',
                   b'{"port":8123,"d1":false,"r2":true,"worker":true}\n']
        for frame in invalid:
            with self.subTest(frame=frame):
                _, report, error = self.read([frame])
                self.assertEqual(error, "worker_projection_invalid")
                self.assertNotIn("workerFailurePhase", report)

    def test_terminal_failure_post_frame_bytes_and_oversize_are_rejected(self):
        for chunks in [[b'{"phase":"build","kind":"error"}\n', b"private"], [b"x" * 1025]]:
            with self.subTest(chunks=chunks):
                _, report, error = self.read(chunks)
                self.assertIn(error, {"worker_projection_invalid", "worker_projection_limit"})
                self.assertNotIn("workerFailurePhase", report)

    def test_worker_readiness_preserves_original_local_and_absolute_deadlines(self):
        worker = MagicMock()
        with patch.object(p.time, "monotonic", side_effect=[100, 146]), patch.object(p, "STEP_END", 300), \
             patch.object(p.select, "select") as select:
            with self.assertRaisesRegex(p.Blocked, "worker_readiness_deadline"):
                p.read_worker_readiness(worker, {})
        select.assert_not_called()
        with patch.object(p.time, "monotonic", return_value=100), patch.object(p, "STEP_END", 99), \
             patch.object(p.select, "select") as select:
            with self.assertRaisesRegex(p.Blocked, "absolute_step_deadline"):
                p.read_worker_readiness(worker, {})
        select.assert_not_called()

    def test_paired_worker_diagnostics_are_closed_and_survive_finalization(self):
        original = {"code": "worker_readiness_failed", "failureKind": "blocked",
                    "workerFailurePhase": "runtime_ready", "workerFailureKind": "error"}
        projected = p.escaped_error_projection(p.FinalizationFailure(p.finalization_projection(original, OSError("private"))))
        self.assertEqual(projected["workerFailurePhase"], "runtime_ready")
        self.assertEqual(projected["workerFailureKind"], "error")
        self.assertEqual(projected["code"], "worker_readiness_failed")
        for delta in [{"workerFailurePhase": "private"}, {"workerFailureKind": "private"},
                      {"workerFailurePhase": True}, {"workerFailureKind": []}]:
            with self.subTest(delta=delta), self.assertRaises(p.Blocked):
                p.public_report({"authenticated": False, "credentialAdmission": False, **original, **delta})
        with self.assertRaises(p.Blocked):
            p.public_report({"authenticated": False, "credentialAdmission": False, "workerFailurePhase": "runtime_ready"})


class WorkflowBootstrapTests(unittest.TestCase):
    def workflow(self):
        local = p.HERE / "hosted-macos-native.yml"
        published = p.HERE.parents[1] / ".github/workflows/hosted-macos-native.yml"
        return (local if local.is_file() else published).read_text()

    def test_signature_capable_bootstrap_precedes_exact_manager_and_locked_install(self):
        workflow = self.workflow()
        ordered = [
            "npm install --global corepack@0.34.0 --ignore-scripts --no-audit --no-fund",
            "corepack enable",
            'test "$(corepack --version)" = "0.34.0"',
            'test "$(pnpm --version)" = "11.8.0"',
            "pnpm install --frozen-lockfile --ignore-scripts",
        ]
        positions = [workflow.index(value) for value in ordered]
        self.assertEqual(positions, sorted(positions))

    def test_bootstrap_preserves_signature_verification_and_node_pin(self):
        workflow = self.workflow()
        self.assertIn("node-version: 22.13.0", workflow)
        self.assertNotIn("COREPACK_INTEGRITY_KEYS", workflow)
        self.assertNotIn("COREPACK_ENABLE_PROJECT_SPEC: 0", workflow)

    def test_finisher_receives_actual_native_step_outcome(self):
        workflow = self.workflow()
        native = workflow[workflow.index("- name: Run the finite native preflight"):workflow.index("- name: Project only safe metadata")]
        finish = workflow[workflow.index("- name: Project only safe metadata"):]
        self.assertIn("id: native", native)
        self.assertIn("if: always()", finish)
        self.assertIn("PREFLIGHT_EXECUTE_OUTCOME: ${{ steps.native.outcome }}", finish)


if __name__ == "__main__":
    unittest.main()
