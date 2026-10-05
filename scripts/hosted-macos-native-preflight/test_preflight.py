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
            write("node_modules/miniflare/package.json", '{"name":"miniflare","main":"index.cjs","version":"4.20260714.0","dependencies":{"workerd":"1.20260714.1"}}')
            write("node_modules/workerd/package.json", '{"name":"workerd","main":"index.cjs","version":"1.20260714.1"}')
            write("node_modules/workerd/index.cjs", "exports.default = require.resolve('@cloudflare/workerd-darwin-arm64/bin/workerd'); exports.version='1.20260714.1';")
            write("node_modules/@cloudflare/workerd-darwin-arm64/package.json", '{"name":"@cloudflare/workerd-darwin-arm64","version":"1.20260714.1","os":["darwin"],"cpu":["arm64"]}')
            write("node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd", 'synthetic-not-an-executable')
            write("binary-mock.mjs", """
import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
Object.defineProperty(process, 'platform', {value: 'darwin'});
Object.defineProperty(process, 'arch', {value: 'arm64'});
const native = '/@cloudflare/workerd-darwin-arm64/bin/workerd';
const originalOpen = fs.open, originalStat = fs.stat;
const metadata = () => ({dev:1n,ino:2n,size:114566712n,mode:0o100755n,
  uid:BigInt(process.getuid()),mtimeNs:3n,ctimeNs:4n,isFile:()=>true});
fs.open = async (path, ...args) => {
  if (!String(path).endsWith(native)) return originalOpen(path, ...args);
  let cursor=0;
  return {stat:async()=>metadata(),close:async()=>{},read:async(buffer,offset,length)=>{
    const count=Math.min(length,114566712-cursor); buffer.fill(0);
    if (cursor===0) Buffer.from('cffaedfe0c000001','hex').copy(buffer);
    cursor+=count; return {bytesRead:count};
  }};
};
fs.stat = async (path, ...args) => String(path).endsWith(native) ? metadata() : originalStat(path, ...args);
crypto.createHash = () => ({update(){return this;},digest(){return (
  process.env.FAKE_STAGE==='runtime_binary_probe' ? '0'.repeat(64)
  : '1b652bc9930d82924f9b416a384df910bc667f88cfb72972a0b39532c94a4cfe');}});
cp.spawn = (path,args,options) => {
  if (!String(path).endsWith(native) || JSON.stringify(args)!=='["--version"]')
    throw new Error('fixture refuses executable launch');
  if (Object.keys(options.env).some(k=>!['PATH','HOME','TMPDIR','LANG'].includes(k)))
    throw new Error('fixture refuses inherited environment');
  const child=new cp.ChildProcess();child.pid=12345;child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{throw new Error('unexpected fake signal');};
  queueMicrotask(()=>{child.stdout.end('workerd 2026-07-14\\n');child.stderr.end();
    child.exitCode=0;child.signalCode=null;child.emit('exit',0,null);child.emit('close',0,null);});
  return child;
};
syncBuiltinESMExports();
""")
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
            cases += [("runtime_loopback_validate", "error"), ("runtime_binary_probe", "binary_digest_mismatch")]
            for phase, kind in cases + [("success", None), ("state_prepare", "error")]:
                with self.subTest(phase=phase, kind=kind):
                    if (owned / "state").is_dir():
                        p.shutil.rmtree(owned / "state")
                    if phase == "state_prepare":
                        (owned / "state").touch(mode=0o600)
                    args = ["node", "--import", str(company / "binary-mock.mjs"), str(p.HERE / "worker.mjs")]
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
                        self.assertEqual(frame, {"port": 8123, "d1": True, "r2": True, "worker": True, "binary": p.WORKER_BINARY_PROOF})
                    else:
                        self.assertEqual(result.returncode, 1)
                        expected_kind = "error" if kind in {"sdk_unknown", "foreign_known", "sdk_getter", "sdk_inherited"} else kind
                        expected = {"phase": phase, "kind": expected_kind}
                        if phase not in {"module_setup", "dependency_import", "runtime_binary_probe"}:
                            expected["binary"] = p.WORKER_BINARY_PROOF
                        self.assertEqual(frame, expected)

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
        frame = json.dumps({"port": 8123, "d1": True, "r2": True, "worker": True, "binary": p.WORKER_BINARY_PROOF}).encode() + b'\n'
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


class RuntimeBinaryControlTests(unittest.TestCase):
    def helper(self, body):
        source = (p.HERE / "worker.mjs").read_text()
        start = source.index("// Binary-only control.")
        helpers = source[start:source.index("async function startup()", start)]
        # Only these exact helper functions run; all filesystem, process and clock APIs are fake.
        script = """
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
let clock=0, opened=0, closedFiles=0, hashValue='1b652bc9930d82924f9b416a384df910bc667f88cfb72972a0b39532c94a4cfe';
let changed=false, readCursor=0, timers=[];
const before={dev:1n,ino:2n,size:114566712n,mode:0o100755n,uid:501n,mtimeNs:3n,ctimeNs:4n,isFile:()=>true};
const metadata={
 'miniflare/package.json':{name:'miniflare',version:'4.20260714.0',dependencies:{workerd:'1.20260714.1'}},
 'workerd/package.json':{name:'workerd',version:'1.20260714.1'},
 '@cloudflare/workerd-darwin-arm64/package.json':{name:'@cloudflare/workerd-darwin-arm64',version:'1.20260714.1',os:['darwin'],cpu:['arm64']}
};
const nativeModule={default:'/native',version:'1.20260714.1'};
const req=(name)=>{if(name==='workerd')return nativeModule;throw new Error('uncontrolled dependency');};
req.resolve=(name)=>name;
const sandbox={Buffer,BigInt,JSON,Object,Number,Error,Set,
 process:{platform:'darwin',arch:'arm64',getuid:()=>501,env:{PATH:'/fake',HOME:'/owned/home',TMPDIR:'/owned/tmp',LANG:'en_US.UTF-8',GITHUB_TOKEN:'synthetic-must-drop'}},
 performance:{now:()=>clock},constants:{O_RDONLY:0,O_NOFOLLOW:0x20000},createRequire:()=>req,
 readFile:async(path)=>Buffer.from(JSON.stringify(metadata[path])),realpath:async()=>'/native',
 stat:async()=>({...before,ino:changed?99n:before.ino}),
 open:async(path,flags)=>{opened++;if(flags!==0x20000)throw new Error('nofollow absent');
  return{stat:async()=>({...before}),close:async()=>{closedFiles++;},read:async(buffer,offset,length)=>{
   const count=Math.min(length,114566712-readCursor);buffer.fill(0);
   if(readCursor===0)Buffer.from('cffaedfe0c000001','hex').copy(buffer);readCursor+=count;return{bytesRead:count};}};},
 createHash:()=>({update(){return this;},digest(){return hashValue;}}),
 setTimeout:(fn,delay)=>{const timer={fn,at:clock+delay,cancelled:false};timers.push(timer);return timer;},
 clearTimeout:(timer)=>{timer.cancelled=true;}
};
vm.createContext(sandbox);
vm.runInContext(HELPERS + '\\nglobalThis.control={verifyRuntimeBinary,runBinaryVersion,BinaryProbeFailure,BINARY_PROOF,BINARY_SHA};',sandbox);
const control=sandbox.control;
async function verify(){try{await control.verifyRuntimeBinary('/sdk',5000);return'passed';}catch(error){return error instanceof control.BinaryProbeFailure?error.kind:'unexpected_exception';}}
function exit(child,code=0,signal=null,close=true){child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);if(close)child.emit('close',code,signal);}
function driveTimers(overdueAt){for(const timer of [...timers].sort((a,b)=>a.at-b.at)){if(!timer.cancelled){clock=overdueAt??timer.at;timer.fn();}}}
async function version(events,options={}){
 clock=0;timers=[];const kills=[];let launch;
 const child=new EventEmitter();child.pid=12345;child.exitCode=null;child.signalCode=null;
 child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=(signal)=>{kills.push(signal);options.onKill?.(child,signal);return true;};
 if(options.unknownOwner){child.exitCode=undefined;child.signalCode=undefined;}
 if(options.invalidPid){child.pid=0;}
 if(options.missingPipes){child.stdout=null;child.stderr=null;}
 sandbox.spawn=(path,args,config)=>{if(options.throwSpawn)throw new Error('private');
  launch={exactArgs:JSON.stringify(args)==='["--version"]',envKeys:Object.keys(config.env).sort(),detached:config.detached,stdio:config.stdio};
  queueMicrotask(()=>events(child));return child;};
 let kind='passed';try{await control.runBinaryVersion({path:'/native',before},5000);}
 catch(error){kind=error instanceof control.BinaryProbeFailure?error.kind:'unexpected_exception';}
 return{kind,kills,launch,clock};
}
const result=await (async()=>{ BODY })();
console.log(JSON.stringify(result));
""".replace("HELPERS", json.dumps(helpers), 1).replace("BODY", body, 1)
        result = p.subprocess.run(["node", "--input-type=module", "-e", script],
                                  env={"PATH": p.os.environ["PATH"]}, capture_output=True, timeout=8)
        self.assertEqual(result.returncode, 0, "Pure helper fixture failed")
        self.assertEqual(result.stderr, b"")
        self.assertLessEqual(len(result.stdout), 4096)
        return json.loads(result.stdout)

    def test_exact_native_identity_digest_and_fd_stat_control(self):
        result = self.helper("const outcome=await verify();return {outcome,opened,closedFiles,proof:control.BINARY_PROOF,sha:control.BINARY_SHA};")
        self.assertEqual(result, {"outcome": "passed", "opened": 1, "closedFiles": 1,
                                  "proof": p.WORKER_BINARY_PROOF, "sha": p.WORKERD_BINARY_SHA})

    def test_platform_metadata_override_and_digest_changes_fail_closed(self):
        for body, expected in [
            ("sandbox.process.arch='x64';", "binary_platform_unproved"),
            ("sandbox.process.platform='linux';", "binary_platform_unproved"),
            ("sandbox.process.env.MINIFLARE_WORKERD_PATH='/private';", "binary_identity_unproved"),
            ("metadata['miniflare/package.json'].version='0.0.0';", "binary_identity_unproved"),
            ("nativeModule.version='0.0.0';", "binary_identity_unproved"),
            ("hashValue='0'.repeat(64);", "binary_digest_mismatch"),
            ("changed=true;", "binary_file_changed"),
        ]:
            with self.subTest(expected=expected):
                result = self.helper(body + "return {outcome:await verify(),closedFiles};")
                self.assertEqual(result["outcome"], expected)

    def test_fragmented_exact_version_exit_and_sanitized_child_environment(self):
        result = self.helper("return await version(child=>{child.stdout.emit('data',Buffer.from('work'));child.stdout.emit('data',Buffer.from('erd 2026-07-14\\n'));exit(child);});")
        self.assertEqual(result["kind"], "passed")
        self.assertEqual(result["kills"], [])
        self.assertEqual(result["launch"], {"exactArgs": True, "envKeys": ["HOME", "LANG", "PATH", "TMPDIR"],
                                           "detached": False, "stdio": ["ignore", "pipe", "pipe"]})

    def test_version_extra_invalid_or_secret_output_is_never_proof(self):
        for value in ["workerd 2026-07-14\\nprivate", "workerd 2026-07-14\\n\\n", "workerd 2026-07-15\\n", "private"]:
            with self.subTest(value=value):
                result = self.helper("return await version(child=>{child.stdout.emit('data',Buffer.from(" + json.dumps(value) + "));exit(child);});")
                self.assertEqual(result["kind"], "binary_probe_output_invalid")
                self.assertNotIn("private", json.dumps(result))

    def test_stderr_output_cap_and_stream_errors_are_closed(self):
        for events, expected in [
            ("child.stderr.emit('data',Buffer.from('private'));", "binary_probe_stderr_present"),
            ("child.stdout.emit('data',Buffer.alloc(257,65));", "binary_probe_output_limit"),
            ("child.stderr.emit('data',Buffer.alloc(257,65));", "binary_probe_output_limit"),
            ("child.stdout.emit('error',new Error('private'));", "binary_probe_stream_failed"),
            ("child.stdout.emit('data','private');", "binary_probe_stream_failed"),
        ]:
            with self.subTest(expected=expected):
                result = self.helper("return await version(child=>{" + events + "exit(child);});")
                self.assertEqual(result["kind"], expected)
                self.assertNotIn("private", json.dumps(result))

    def test_spawn_exit_signal_and_close_are_distinct_finite_controls(self):
        for body, expected in [
            ("return await version(()=>{},{throwSpawn:true});", "binary_probe_spawn_failed"),
            ("return await version(child=>{child.emit('error',new Error('private'));child.emit('close');});", "binary_probe_spawn_failed"),
            ("return await version(child=>{child.emit('error',new Error('private'));child.emit('close');},{missingPipes:true});", "binary_probe_stream_failed"),
            ("return await version(child=>exit(child,1));", "binary_probe_nonzero_exit"),
            ("return await version(child=>exit(child,null,'SIGABRT'));", "binary_probe_terminated"),
            ("return await version(child=>child.emit('close'));", "binary_probe_cleanup_unproved"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(self.helper(body)["kind"], expected)

    def test_deadline_escalates_only_original_unreaped_child_inside_same_budget(self):
        result = self.helper("return await version(()=>driveTimers());")
        self.assertEqual(result["kind"], "binary_probe_deadline")
        self.assertEqual(result["kills"], ["SIGTERM", "SIGKILL"])
        self.assertEqual(result["clock"], 5000)
        result = self.helper("return await version(()=>driveTimers(),{onKill:(child,signal)=>{if(signal==='SIGTERM')exit(child,0,null,false);}});")
        self.assertEqual(result["kills"], ["SIGTERM"])
        self.assertEqual(result["kind"], "binary_probe_deadline")
        result = self.helper("return await version(()=>driveTimers(),{unknownOwner:true});")
        self.assertEqual(result["kills"], [])
        self.assertEqual(result["kind"], "binary_probe_deadline")

    def test_binary_proof_is_exact_scalar_and_survives_secondary_cleanup_failure(self):
        report = {"code": "worker_readiness_failed", "failureKind": "blocked", "workerFailurePhase": "runtime_ready",
                  "workerFailureKind": "miniflare_runtime_failure", "workerBinaryProof": p.WORKER_BINARY_PROOF}
        carried = p.FinalizationFailure(p.finalization_projection(report, PermissionError("private")))
        result = p.escaped_error_projection(carried)
        self.assertEqual(result["workerBinaryProof"], p.WORKER_BINARY_PROOF)
        self.assertEqual(result["code"], "worker_readiness_failed")
        self.assertEqual(result["cleanupFailureCodes"], ["cleanup_finalization_permission_denied"])
        self.assertEqual(result["status"], "cleanup_failed")
        self.assertFalse(result["cleanupComplete"])
        result["workerBinaryProof"] = "private"
        self.assertEqual(carried.projection["workerBinaryProof"], p.WORKER_BINARY_PROOF)
        for invalid in [True, False, None, {}, "private"]:
            with self.subTest(invalid=invalid), self.assertRaises(p.Blocked):
                p.public_report({"authenticated": False, "credentialAdmission": False, "workerBinaryProof": invalid})

    def test_strict_terminal_binary_proof_cannot_promote_failed_gate(self):
        for frame in [
            {"port": 8123, "d1": True, "r2": True, "worker": True},
            {"phase": "runtime_binary_probe", "kind": "binary_probe_deadline", "binary": p.WORKER_BINARY_PROOF},
            {"phase": "runtime_ready", "kind": "miniflare_runtime_failure", "binary": True},
        ]:
            with self.subTest(frame=frame), self.assertRaises(p.Blocked):
                p.parse_worker_frame(json.dumps(frame).encode())
        frame = {"phase": "runtime_ready", "kind": "miniflare_runtime_failure", "binary": p.WORKER_BINARY_PROOF}
        self.assertEqual(p.parse_worker_frame(json.dumps(frame).encode()), frame)

    def test_success_without_native_binary_proof_is_refused(self):
        with self.assertRaises(p.Blocked):
            p.parse_worker_frame(b'{"port":8123,"d1":true,"r2":true,"worker":true}\n')

    def test_binary_pin_remains_stable_after_version_child_closes(self):
        result = self.helper("return await version(child=>{child.stdout.emit('data',Buffer.from('workerd 2026-07-14\\n'));exit(child);changed=true;});")
        self.assertEqual(result["kind"], "binary_file_changed")

    def test_version_close_without_owned_child_pid_is_not_proof(self):
        result = self.helper("return await version(child=>{child.stdout.emit('data',Buffer.from('workerd 2026-07-14\\n'));exit(child);},{invalidPid:true});")
        self.assertEqual(result["kind"], "binary_probe_cleanup_unproved")

    def test_overdue_timer_callbacks_never_signal_after_native_deadline(self):
        result = self.helper("return await version(()=>driveTimers(5001));")
        self.assertEqual(result["kind"], "binary_probe_deadline")
        self.assertEqual(result["clock"], 5001)
        self.assertEqual(result["kills"], [])

    def test_output_error_callbacks_cannot_signal_at_or_after_native_deadline(self):
        for now in [5000, 5001]:
            for event, expected in [
                ("child.stdout.emit('data',Buffer.alloc(257,65));", "binary_probe_output_limit"),
                ("child.stdout.emit('data','private');", "binary_probe_stream_failed"),
            ]:
                with self.subTest(now=now, expected=expected):
                    result = self.helper("return await version(child=>{clock=" + str(now) + ";" + event + "exit(child);});")
                    self.assertEqual(result["kind"], expected)
                    self.assertEqual(result["kills"], [])
                    self.assertNotIn("private", json.dumps(result))


class RuntimeFailureMessageTests(unittest.TestCase):
    STDERR_PREFIX = ("The Workers runtime failed to start. There was likely a problem with the workerd binary or your configuration.\n"
                     "Runtime stderr:\n")
    PORTS_MESSAGE = "The Workers runtime failed to start. There is likely additional logging output above."
    INSPECTOR_MESSAGE = "Unable to access the runtime inspector socket."
    NEW_KINDS = ("miniflare_runtime_stderr_present", "miniflare_runtime_ports_missing",
                 "miniflare_runtime_inspector_socket_missing")

    def classifier(self, body):
        source = (p.HERE / "worker.mjs").read_text()
        marker = "function runtimeFailureKind(error)"
        start = source.index(marker if marker in source else "function failureKind(error)")
        helpers = source[start:source.index("startup().catch", start)]
        # Extract only pure classifiers. No Worker entrypoint, SDK, runtime or target is loaded.
        script = """
const vm = require('node:vm');
let byteLengthCalls = 0;
let forbiddenCalls = 0;
const forbidden = () => { forbiddenCalls++; throw new Error('fixture_forbidden_api'); };
const sandbox = {
  publicMessages: PUBLIC_MESSAGES,
  console: {log:forbidden, error:forbidden, warn:forbidden},
  process: {stdout:{write:forbidden}, stderr:{write:forbidden}, exit:forbidden},
  require:forbidden, fetch:forbidden, spawn:forbidden,
  Buffer: {byteLength(value, encoding) {
    byteLengthCalls++;
    if (typeof value !== 'string' || value.length > 16384)
      throw new Error('fixture_unsafe_byte_length_input');
    if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'utf-8')
      throw new Error('fixture_unsafe_byte_length_encoding');
    return Buffer.byteLength(value, encoding);
  }, from:forbidden, alloc:forbidden},
  byteLengthCalls: () => byteLengthCalls,
};
vm.createContext(sandbox);
const prelude = `
class BinaryProbeFailure extends Error {}
const BINARY_FAILURE_KINDS = new Set(['binary_digest_mismatch']);
let miniflareCoreErrorClass = class MiniflareCoreError extends Error {
  constructor(code, message) {
    super();
    Object.defineProperty(this, 'code', {value:code, writable:true, configurable:true});
    if (arguments.length > 1)
      Object.defineProperty(this, 'message', {value:message, writable:true, configurable:true});
  }
};
const [stderrPrefix, portsMessage, inspectorMessage] = publicMessages;
const secretSentinel = 'FICTIONAL_RUNTIME_SECRET_17';
const urlSentinel = 'https://fictional-runtime.invalid/diagnostic?token=FICTIONAL_RUNTIME_SECRET_17';
let helperCalls = 0;
`;
const instrumentation = `
if (typeof runtimeFailureKind === 'function') {
  const original = runtimeFailureKind;
  runtimeFailureKind = function(error) { helperCalls++; return original(error); };
}
function classify(error) {
  try { return failureKind(error); }
  catch { return 'fixture_unexpected_throw'; }
}
`;
const result = vm.runInContext(prelude + HELPERS + instrumentation
  + BODY, sandbox, {timeout:1000});
process.stdout.write(JSON.stringify({value:result, forbiddenCalls}) + '\\n');
""".replace("PUBLIC_MESSAGES", json.dumps([self.STDERR_PREFIX, self.PORTS_MESSAGE, self.INSPECTOR_MESSAGE]), 1)
        script = script.replace("HELPERS", json.dumps(helpers), 1).replace(
            "BODY", json.dumps("\n(() => { " + body + " })()"), 1)
        result = p.subprocess.run(["node", "--input-type=commonjs", "-e", script],
                                  env={"PATH": p.os.environ["PATH"]}, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, "Pure runtime classifier fixture failed")
        self.assertTrue(result.stderr == b"", "Pure runtime classifier fixture emitted stderr")
        self.assertLessEqual(len(result.stdout), 4096)
        for sentinel in [b"FICTIONAL_RUNTIME_SECRET_17", b"fictional-runtime.invalid"]:
            self.assertTrue(sentinel not in result.stdout, "Classifier copied a fictional private field")
        projected = json.loads(result.stdout)
        self.assertEqual(projected["forbiddenCalls"], 0)
        return projected["value"]

    def test_runtime_message_stderr_exact_prefix_has_closed_label(self):
        result = self.classifier("return {kind:classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',stderrPrefix+secretSentinel+' '+urlSentinel))};")
        self.assertEqual(result, {"kind": "miniflare_runtime_stderr_present"})

    def test_runtime_message_ports_exact_whole_message_has_closed_label(self):
        result = self.classifier("return {kind:classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',portsMessage))};")
        self.assertEqual(result, {"kind": "miniflare_runtime_ports_missing"})

    def test_runtime_message_inspector_exact_whole_message_has_closed_label(self):
        result = self.classifier("return {kind:classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',inspectorMessage))};")
        self.assertEqual(result, {"kind": "miniflare_runtime_inspector_socket_missing"})

    def test_runtime_message_missing_own_data_and_accessors_are_generic_without_reads(self):
        result = self.classifier(r"""
let getters=0;
const missing=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
const ownAccessor=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.defineProperty(ownAccessor,'message',{get(){getters++;return portsMessage;}});
const inheritedValue=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.setPrototypeOf(inheritedValue,Object.create(miniflareCoreErrorClass.prototype,{message:{value:inspectorMessage}}));
const inheritedAccessor=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.setPrototypeOf(inheritedAccessor,Object.create(miniflareCoreErrorClass.prototype,{message:{get(){getters++;return portsMessage;}}}));
return {kinds:[missing,ownAccessor,inheritedValue,inheritedAccessor].map(classify),
  getters,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_failure"] * 4, "getters": 0, "bytes": 0})

    def test_runtime_message_nonprimitive_values_never_coerce_or_measure_bytes(self):
        result = self.classifier(r"""
let coercions=0, lengthReads=0;
const coercible={
  get length(){lengthReads++;return 1;},
  toString(){coercions++;throw new Error(secretSentinel);},
  valueOf(){coercions++;throw new Error(secretSentinel);},
  [Symbol.toPrimitive](){coercions++;throw new Error(secretSentinel);}
};
const messages=[new String(portsMessage),coercible,null,undefined,1,true,Symbol('fictional'),1n,()=>portsMessage];
return {kinds:messages.map(message=>classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',message))),
  coercions,lengthReads,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_failure"] * 9,
                                  "coercions": 0, "lengthReads": 0, "bytes": 0})

    def test_runtime_message_outer_class_and_own_code_gates_never_touch_message(self):
        result = self.classifier(r"""
let codeGetters=0, messageGetters=0, descriptorReads=0, coercions=0;
const guarded=error=>{
  Object.defineProperty(error,'message',{get(){messageGetters++;return portsMessage;},configurable:true});
  return new Proxy(error,{getOwnPropertyDescriptor(target,key){
    if(key==='message')descriptorReads++;
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
};
const foreign=new Error();
Object.defineProperty(foreign,'code',{value:'ERR_RUNTIME_FAILURE'});
const missing=new miniflareCoreErrorClass('unused');delete missing.code;
const inherited=new miniflareCoreErrorClass('unused');delete inherited.code;
Object.setPrototypeOf(inherited,Object.create(miniflareCoreErrorClass.prototype,{code:{value:'ERR_RUNTIME_FAILURE'}}));
const accessor=new miniflareCoreErrorClass('unused');
Object.defineProperty(accessor,'code',{get(){codeGetters++;throw new Error(secretSentinel);}});
const coercible={toString(){coercions++;return 'ERR_RUNTIME_FAILURE';},
  [Symbol.toPrimitive](){coercions++;return 'ERR_RUNTIME_FAILURE';}};
const errors=[foreign,missing,inherited,accessor,
  new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE '),
  new miniflareCoreErrorClass(new String('ERR_RUNTIME_FAILURE')),
  new miniflareCoreErrorClass(coercible),new miniflareCoreErrorClass('ERR_ADDRESS_IN_USE')];
const kinds=errors.map(error=>classify(guarded(error)));
const unpinned=guarded(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE'));
miniflareCoreErrorClass=undefined;kinds.push(classify(unpinned));
return {kinds,codeGetters,messageGetters,descriptorReads,coercions,helperCalls,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kinds": ["error"] * 7 + ["miniflare_address_in_use", "error"],
                                  "codeGetters": 0, "messageGetters": 0, "descriptorReads": 0,
                                  "coercions": 0, "helperCalls": 0, "bytes": 0})

    def test_runtime_message_descriptor_failure_is_generic_without_exception_output(self):
        result = self.classifier(r"""
let messageDescriptors=0;
const error=new Proxy(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',portsMessage),{
  getOwnPropertyDescriptor(target,key){
    if(key==='message'){messageDescriptors++;throw new Error(secretSentinel+' '+urlSentinel);}
    return Reflect.getOwnPropertyDescriptor(target,key);
  }
});
return {kind:classify(error),messageDescriptors,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kind": "miniflare_runtime_failure", "messageDescriptors": 1, "bytes": 0})

    def test_runtime_message_ascii_exact_cap_and_utf16_overcap_are_distinct(self):
        result = self.classifier(r"""
const exact=stderrPrefix+'x'.repeat(16384-stderrPrefix.length);
const accepted=classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',exact));
const measured=byteLengthCalls();
const over=classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',exact+'x'));
return {accepted,over,units:exact.length,acceptedMeasurements:measured,overMeasurements:byteLengthCalls()-measured};
""")
        self.assertEqual(result, {"accepted": "miniflare_runtime_stderr_present",
                                  "over": "miniflare_runtime_failure", "units": 16384,
                                  "acceptedMeasurements": 1, "overMeasurements": 0})

    def test_runtime_message_utf8_exact_cap_overcap_and_surrogates_are_bounded(self):
        result = self.classifier(r"""
const remaining=16384-stderrPrefix.length;
const exact=stderrPrefix+'é'.repeat(Math.floor(remaining/2))+'x'.repeat(remaining%2);
const messages=[exact,exact+'x',stderrPrefix+'😀'.repeat(5000),stderrPrefix+'\ud800'.repeat(6000)];
return {kinds:messages.map(message=>classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',message))),
  belowUtf16Cap:messages.every(message=>message.length<=16384),bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_stderr_present"] + ["miniflare_runtime_failure"] * 3,
                                  "belowUtf16Cap": True, "bytes": 4})

    def test_runtime_message_unknown_partial_whitespace_and_extra_text_are_generic(self):
        result = self.classifier(r"""
const messages=[
  '',secretSentinel+' '+urlSentinel,stderrPrefix,stderrPrefix+' ',stderrPrefix+'\t\r\n',
  stderrPrefix+'\u00a0\ufeff',stderrPrefix.slice(0,-1)+'x',
  stderrPrefix.replace('\n','\r\n')+'x',stderrPrefix.toLowerCase()+'x',
  ' '+stderrPrefix+'x','different '+stderrPrefix+'x',
  stderrPrefix.replace('Runtime stderr:','Runtime stderr')+'x',
  portsMessage+' ',portsMessage+'\n',portsMessage+secretSentinel,'different '+portsMessage,
  inspectorMessage+' ',inspectorMessage+'\n',inspectorMessage+urlSentinel,'different '+inspectorMessage
];
return {kinds:messages.map(message=>classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',message)))};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_failure"] * 20})

    def test_runtime_message_existing_nonruntime_classifiers_remain_closed(self):
        result = self.classifier(r"""
const binary=new BinaryProbeFailure();
Object.defineProperty(binary,'kind',{value:'binary_digest_mismatch'});
return {kinds:[binary,new TypeError(secretSentinel),new RangeError(secretSentinel),
  new SyntaxError(secretSentinel),new ReferenceError(secretSentinel),new Error(secretSentinel),
  secretSentinel,null].map(classify),helperCalls,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {"kinds": ["binary_digest_mismatch", "type_error", "range_error",
                                           "syntax_error", "reference_error", "error", "unknown_exception",
                                           "unknown_exception"], "helperCalls": 0, "bytes": 0})

    def test_runtime_message_new_labels_are_terminal_failure_frames_not_readiness(self):
        reader = WorkerReadinessTests()
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                frame = {"phase": "runtime_ready", "kind": kind, "binary": p.WORKER_BINARY_PROOF}
                raw = json.dumps(frame).encode() + b"\n"
                self.assertEqual(p.parse_worker_frame(raw), frame)
                value, report, code = reader.read([raw[:9], raw[9:], b""], exited=1)
                self.assertIsNone(value)
                self.assertEqual(code, "worker_readiness_failed")
                self.assertEqual(report["workerFailurePhase"], "runtime_ready")
                self.assertEqual(report["workerFailureKind"], kind)
                self.assertEqual(report["workerBinaryProof"], p.WORKER_BINARY_PROOF)
                self.assertFalse(report["authenticated"])
                self.assertFalse(report["credentialAdmission"])
                self.assertTrue({"workerReady", "d1Ready", "r2Ready", "port"}.isdisjoint(report))

    def test_runtime_message_new_labels_survive_failed_finalization_without_admission(self):
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                report = {"status": "pre_auth_blocked", "code": "worker_readiness_failed", "failureKind": "blocked",
                          "workerFailurePhase": "runtime_ready", "workerFailureKind": kind,
                          "workerBinaryProof": p.WORKER_BINARY_PROOF, "nativeExecuted": False,
                          "authenticated": False, "credentialAdmission": False}
                projected = p.escaped_error_projection(p.FinalizationFailure(p.finalization_projection(
                    report, PermissionError("FICTIONAL_RUNTIME_SECRET_17"))))
                self.assertEqual(projected["status"], "cleanup_failed")
                self.assertEqual(projected["code"], "worker_readiness_failed")
                self.assertEqual(projected["failureKind"], "blocked")
                self.assertEqual(projected["workerFailurePhase"], "runtime_ready")
                self.assertEqual(projected["workerFailureKind"], kind)
                self.assertEqual(projected["workerBinaryProof"], p.WORKER_BINARY_PROOF)
                self.assertEqual(projected["cleanupFailureCodes"], ["cleanup_finalization_permission_denied"])
                self.assertFalse(projected["cleanupComplete"])
                self.assertFalse(projected["nativeExecuted"])
                self.assertFalse(projected["authenticated"])
                self.assertFalse(projected["credentialAdmission"])
                p.apply_execute_outcome(projected, "success")
                self.assertEqual(projected["status"], "cleanup_failed")
                self.assertFalse(projected["credentialAdmission"])
                self.assertTrue("FICTIONAL_RUNTIME_SECRET_17" not in json.dumps(projected))

    def test_runtime_message_new_enum_refuses_raw_fields_unknown_or_partial_labels(self):
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                frame = {"phase": "runtime_ready", "kind": kind}
                for extra in [{"stderr": "FICTIONAL_RUNTIME_SECRET_17"}, {"message": self.PORTS_MESSAGE}]:
                    with self.assertRaisesRegex(p.Blocked, "worker_projection_invalid"):
                        p.parse_worker_frame(json.dumps({**frame, **extra}).encode())
                for invalid in [kind + "_extra", True, [], "FICTIONAL_RUNTIME_SECRET_17"]:
                    with self.assertRaisesRegex(p.Blocked, "worker_projection_invalid"):
                        p.parse_worker_frame(json.dumps({**frame, "kind": invalid}).encode())
                with self.assertRaisesRegex(p.Blocked, "worker_failure_projection_invalid"):
                    p.public_report({"workerFailureKind": kind, "authenticated": False, "credentialAdmission": False})


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


class RuntimeNativeModuleMarkerTests(unittest.TestCase):
    NO_SUCH_MODULE = 'No such module "fixture-module".\n  imported from "fixture-entry"'
    INVALID_SPECIFIER = (
        'Invalid module specifier "fixture-module".\n'
        '  imported from "fixture-entry".'
    )
    AWAIT_DISALLOWED = "Top-level await in module is not permitted at this time."
    AWAIT_UNSETTLED = "Top-level await in module is unsettled."
    RESOLUTION_KIND = "miniflare_runtime_module_resolution_marker"
    EVALUATION_KIND = "miniflare_runtime_module_evaluation_marker"
    NEW_KINDS = (RESOLUTION_KIND, EVALUATION_KIND)

    def classifier(self, body):
        constants = (
            "const [noSuchModule,invalidSpecifier,awaitDisallowed,awaitUnsettled]="
            + json.dumps([
                self.NO_SUCH_MODULE, self.INVALID_SPECIFIER,
                self.AWAIT_DISALLOWED, self.AWAIT_UNSETTLED,
            ]) + ";\n"
        )
        result = RuntimeFailureMessageTests().classifier(constants + body)
        projected = json.dumps(result)
        for sentinel in ["FICTIONAL_NATIVE_SECRET_18", "fictional-native.invalid"]:
            self.assertTrue(
                sentinel not in projected, "Classifier copied a fictional private field"
            )
        return result

    def test_native_no_such_module_template_has_resolution_label(self):
        result = self.classifier(
            "return {kind:classify(new miniflareCoreErrorClass("
            "'ERR_RUNTIME_FAILURE',stderrPrefix+noSuchModule))};"
        )
        self.assertEqual(result, {"kind": self.RESOLUTION_KIND})

    def test_native_invalid_specifier_template_has_resolution_label(self):
        result = self.classifier(
            "return {kind:classify(new miniflareCoreErrorClass("
            "'ERR_RUNTIME_FAILURE',stderrPrefix+invalidSpecifier))};"
        )
        self.assertEqual(result, {"kind": self.RESOLUTION_KIND})

    def test_native_top_level_await_disallowed_has_evaluation_label(self):
        result = self.classifier(
            "return {kind:classify(new miniflareCoreErrorClass("
            "'ERR_RUNTIME_FAILURE',stderrPrefix+awaitDisallowed))};"
        )
        self.assertEqual(result, {"kind": self.EVALUATION_KIND})

    def test_native_top_level_await_unsettled_has_evaluation_label(self):
        result = self.classifier(
            "return {kind:classify(new miniflareCoreErrorClass("
            "'ERR_RUNTIME_FAILURE',stderrPrefix+awaitUnsettled))};"
        )
        self.assertEqual(result, {"kind": self.EVALUATION_KIND})

    def test_native_templates_accept_only_documented_start_and_end_boundaries(self):
        result = self.classifier(r"""
const variants=marker=>[marker,'\n'+marker,'public prefix: '+marker,
  'public prefix\n'+marker+'\nother public text','public prefix: '+marker+'\n'];
return {kinds:[noSuchModule,invalidSpecifier,awaitDisallowed,awaitUnsettled]
  .flatMap(variants).map(tail=>classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {
            "kinds": [self.RESOLUTION_KIND] * 10 + [self.EVALUATION_KIND] * 10
        })

    def test_native_resolution_truncation_punctuation_and_wrappers_do_not_match(self):
        result = self.classifier(r"""
const invalid=[
  'No such module',noSuchModule.slice(0,-1),invalidSpecifier.slice(0,-1),
  noSuchModule+'.',invalidSpecifier+'.',
  noSuchModule.replace('".\n','"\n'),noSuchModule.replace('".\n','"..\n'),
  noSuchModule.replace('\n  imported','\n imported'),
  noSuchModule.replace('\n  imported','\n   imported'),
  noSuchModule.replace('\n','\r\n'),noSuchModule.replace('No such','no such'),
  'other '+noSuchModule,'other:'+noSuchModule,'other:  '+noSuchModule,
  noSuchModule+' trailing',noSuchModule+' ',noSuchModule+'\r',
  invalidSpecifier+' trailing',invalidSpecifier+' ',
  'No such module "fixture-module".', 'Invalid module specifier "fixture-module".',
  'imported from "fixture-entry"', '"'+noSuchModule+'"'
];
return {kinds:invalid.map(tail=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_stderr_present"] * 23})

    def test_native_evaluation_requires_whole_exact_sentences(self):
        result = self.classifier(r"""
const invalid=[awaitDisallowed.slice(0,-1),awaitUnsettled.slice(0,-1),
  awaitDisallowed+'.',awaitUnsettled+'.',awaitDisallowed+' ',
  awaitUnsettled+' trailing',
  awaitDisallowed+'\r',awaitUnsettled.toLowerCase(),'other '+awaitDisallowed,
  'other:'+awaitUnsettled,'other:  '+awaitUnsettled,
  'Top-level await','Top-level await in module is unsettled',
  '"'+awaitDisallowed+'"',awaitDisallowed.replace('module','modules')];
return {kinds:invalid.map(tail=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_stderr_present"] * 15})

    def test_native_resolution_operands_are_nonempty_bounded_utf16_values(self):
        result = self.classifier(r"""
const missing=(module,referrer)=>'No such module "'+module+
  '".\n  imported from "'+referrer+'"';
const specifier=(module,referrer)=>'Invalid module specifier "'+module+
  '".\n  imported from "'+referrer+'".';
const valid=[missing('x','y'),missing('x'.repeat(512),'y'.repeat(512)),
  missing('😀'.repeat(256),'😀'.repeat(256)),specifier('x'.repeat(512),'y'.repeat(512)),
  specifier('😀'.repeat(256),'😀'.repeat(256))];
const invalid=[];
for(const template of [missing,specifier]){
  for(const operand of [
    '', 'x'.repeat(513),'😀'.repeat(256)+'x','x"y','x\ry','x\ny'
  ]){
    invalid.push(template(operand,'valid'),template('valid',operand));
  }
}
return {valid:valid.map(tail=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+tail))),
  invalid:invalid.map(tail=>classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {"valid": [self.RESOLUTION_KIND] * 5,
                                  "invalid": ["miniflare_runtime_stderr_present"] * 24})

    def test_native_duplicate_and_cross_category_matches_remain_unclassified(self):
        result = self.classifier(r"""
const tails=[noSuchModule+'\n'+noSuchModule,invalidSpecifier+'\n'+invalidSpecifier,
  awaitDisallowed+'\n'+awaitDisallowed,awaitUnsettled+'\n'+awaitUnsettled,
  noSuchModule+'\n'+invalidSpecifier,awaitDisallowed+'\n'+awaitUnsettled,
  noSuchModule+'\n'+awaitDisallowed,awaitUnsettled+'\n'+invalidSpecifier,
  noSuchModule+'\npublic prefix: '+noSuchModule,
  awaitDisallowed+'\npublic prefix: '+awaitUnsettled,
  noSuchModule+'\n'+awaitDisallowed+'\n'+invalidSpecifier];
return {kinds:tails.map(tail=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {"kinds": ["miniflare_runtime_stderr_present"] * 11})

    def test_native_one_valid_template_among_nonmatching_text_is_not_ambiguous(self):
        result = self.classifier(r"""
const tails=['No such module\n'+noSuchModule,
  awaitDisallowed+'\nTop-level await',
  noSuchModule+'\n'+invalidSpecifier.slice(0,-1),
  'public text\n'+awaitUnsettled+'\npublic text'];
return {kinds:tails.map(tail=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+tail)))};
""")
        self.assertEqual(result, {
            "kinds": [self.RESOLUTION_KIND, self.EVALUATION_KIND,
                      self.RESOLUTION_KIND, self.EVALUATION_KIND]
        })

    def test_native_outer_sdk_class_and_own_code_gates_do_not_read_message(self):
        result = self.classifier(r"""
let codeGetters=0,messageGetters=0,descriptorReads=0,coercions=0;
const guard=error=>{
  Object.defineProperty(error,'message',{
    get(){messageGetters++;return stderrPrefix+noSuchModule;},configurable:true
  });
  return new Proxy(error,{getOwnPropertyDescriptor(target,key){
    if(key==='message')descriptorReads++;
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
};
const foreign=new Error();
Object.defineProperty(foreign,'code',{value:'ERR_RUNTIME_FAILURE'});
const absent=new miniflareCoreErrorClass('unused');delete absent.code;
const inherited=new miniflareCoreErrorClass('unused');delete inherited.code;
Object.setPrototypeOf(inherited,Object.create(miniflareCoreErrorClass.prototype,{
  code:{value:'ERR_RUNTIME_FAILURE'}
}));
const accessor=new miniflareCoreErrorClass('unused');
Object.defineProperty(accessor,'code',{
  get(){codeGetters++;throw new Error(secretSentinel);}
});
const coercible={[Symbol.toPrimitive](){coercions++;return 'ERR_RUNTIME_FAILURE';}};
const kinds=[foreign,absent,inherited,accessor,
  new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE '),
  new miniflareCoreErrorClass(new String('ERR_RUNTIME_FAILURE')),
  new miniflareCoreErrorClass(coercible),
  new miniflareCoreErrorClass('ERR_ADDRESS_IN_USE')].map(error=>classify(guard(error)));
const unpinned=guard(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE'));
miniflareCoreErrorClass=undefined;kinds.push(classify(unpinned));
return {kinds,codeGetters,messageGetters,descriptorReads,coercions,helperCalls,
  bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {
            "kinds": ["error"] * 7 + ["miniflare_address_in_use", "error"],
            "codeGetters": 0, "messageGetters": 0, "descriptorReads": 0,
            "coercions": 0, "helperCalls": 0, "bytes": 0,
        })

    def test_native_message_requires_own_primitive_data_without_getters_or_coercion(
        self,
    ):
        result = self.classifier(r"""
let getters=0,coercions=0,lengthReads=0;
const missing=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
const ownAccessor=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.defineProperty(ownAccessor,'message',{
  get(){getters++;return stderrPrefix+noSuchModule;}
});
const inherited=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.setPrototypeOf(inherited,Object.create(miniflareCoreErrorClass.prototype,{
  message:{value:stderrPrefix+noSuchModule}
}));
const inheritedAccessor=new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE');
Object.setPrototypeOf(inheritedAccessor,
  Object.create(miniflareCoreErrorClass.prototype,{
    message:{get(){getters++;return stderrPrefix+noSuchModule;}}
  }));
const coercible={get length(){lengthReads++;return 1;},
  toString(){coercions++;throw new Error(secretSentinel);},
  valueOf(){coercions++;throw new Error(secretSentinel);},
  [Symbol.toPrimitive](){coercions++;throw new Error(secretSentinel);}};
const errors=[missing,ownAccessor,inherited,inheritedAccessor,
  ...[new String(stderrPrefix+noSuchModule),coercible,null,undefined,
    1,true,Symbol('fixture'),1n]
    .map(message=>new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',message))];
return {kinds:errors.map(classify),getters,coercions,lengthReads,
  bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {
            "kinds": ["miniflare_runtime_failure"] * 12,
            "getters": 0, "coercions": 0, "lengthReads": 0, "bytes": 0,
        })

    def test_native_message_descriptor_failure_preserves_generic_closed_label(self):
        result = self.classifier(r"""
let messageDescriptors=0;
const error=new Proxy(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+noSuchModule),{
  getOwnPropertyDescriptor(target,key){
    if(key==='message'){
      messageDescriptors++;throw new Error(secretSentinel+' '+urlSentinel);
    }
    return Reflect.getOwnPropertyDescriptor(target,key);
  }
});
return {kind:classify(error),messageDescriptors,bytes:byteLengthCalls()};
""")
        self.assertEqual(result, {
            "kind": "miniflare_runtime_failure", "messageDescriptors": 1, "bytes": 0
        })

    def test_native_sdk_prefix_remains_exact_and_unknown_stderr_stays_generic(self):
        result = self.classifier(r"""
const wrong=[noSuchModule,' '+stderrPrefix+noSuchModule,
  stderrPrefix.toLowerCase()+noSuchModule,stderrPrefix.replace('\n','\r\n')+noSuchModule,
  stderrPrefix.slice(0,-1)+noSuchModule];
return {wrong:wrong.map(message=>classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',message))),
  unknown:classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+'public unknown diagnostic')),
  ports:classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',portsMessage)),
  inspector:classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',inspectorMessage))};
""")
        self.assertEqual(result, {
            "wrong": ["miniflare_runtime_failure"] * 5,
            "unknown": "miniflare_runtime_stderr_present",
            "ports": "miniflare_runtime_ports_missing",
            "inspector": "miniflare_runtime_inspector_socket_missing",
        })

    def test_native_messages_respect_ascii_utf16_and_utf8_caps_before_matching(self):
        result = self.classifier(r"""
const remaining=16384-stderrPrefix.length-noSuchModule.length-1;
const ascii=stderrPrefix+'x'.repeat(remaining)+'\n'+noSuchModule;
const acceptedAscii=classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',ascii));
const beforeOver=byteLengthCalls();
const overAscii=classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',ascii+'x'));
const asciiOverMeasurements=byteLengthCalls()-beforeOver;
const utf8=stderrPrefix+'é'.repeat(Math.floor(remaining/2))+
  'x'.repeat(remaining%2)+'\n'+noSuchModule;
const utf8Over=stderrPrefix+'é'.repeat(Math.floor(remaining/2))+
  'x'.repeat(remaining%2+1)+'\n'+noSuchModule;
const kinds=[utf8,utf8Over,stderrPrefix+'😀'.repeat(5000)+'\n'+noSuchModule,
  stderrPrefix+'\ud800'.repeat(6000)+'\n'+noSuchModule]
  .map(message=>classify(new miniflareCoreErrorClass('ERR_RUNTIME_FAILURE',message)));
return {acceptedAscii,overAscii,asciiUnits:ascii.length,asciiOverMeasurements,kinds,
  utf8UnderUtf16Cap:utf8Over.length<=16384};
""")
        self.assertEqual(result, {
            "acceptedAscii": self.RESOLUTION_KIND,
            "overAscii": "miniflare_runtime_failure", "asciiUnits": 16384,
            "asciiOverMeasurements": 0,
            "kinds": [self.RESOLUTION_KIND] + ["miniflare_runtime_failure"] * 3,
            "utf8UnderUtf16Cap": True,
        })

    def test_native_operands_secret_urls_and_unknown_details_are_never_projected(self):
        result = self.classifier(r"""
const secret='FICTIONAL_NATIVE_SECRET_18';
const url='https://fictional-native.invalid/module?token='+secret;
const resolution='No such module "'+url+'".\n  imported from "'+secret+'"';
return {resolution:classify(new miniflareCoreErrorClass(
  'ERR_RUNTIME_FAILURE',stderrPrefix+resolution)),
  evaluation:classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+secret+'\n'+awaitUnsettled+'\n'+url)),
  unknown:classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+secret+' '+url)),
  ambiguous:classify(new miniflareCoreErrorClass(
    'ERR_RUNTIME_FAILURE',stderrPrefix+resolution+'\n'+awaitUnsettled))};
""")
        self.assertEqual(result, {
            "resolution": self.RESOLUTION_KIND, "evaluation": self.EVALUATION_KIND,
            "unknown": "miniflare_runtime_stderr_present",
            "ambiguous": "miniflare_runtime_stderr_present",
        })

    def test_native_new_labels_are_terminal_frames_without_readiness_or_admission(
        self,
    ):
        reader = WorkerReadinessTests()
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                frame = {
                    "phase": "runtime_ready", "kind": kind,
                    "binary": p.WORKER_BINARY_PROOF,
                }
                raw = json.dumps(frame).encode() + b"\n"
                self.assertEqual(p.parse_worker_frame(raw), frame)
                value, report, code = reader.read([raw[:9], raw[9:], b""], exited=1)
                self.assertIsNone(value)
                self.assertEqual(code, "worker_readiness_failed")
                self.assertEqual(report["workerFailurePhase"], "runtime_ready")
                self.assertEqual(report["workerFailureKind"], kind)
                self.assertEqual(report["workerBinaryProof"], p.WORKER_BINARY_PROOF)
                self.assertFalse(report["authenticated"])
                self.assertFalse(report["credentialAdmission"])
                self.assertTrue(
                    {"workerReady", "d1Ready", "r2Ready", "port"}.isdisjoint(report)
                )

    def test_native_new_labels_survive_secondary_cleanup_failure_without_admission(
        self,
    ):
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                report = {
                    "status": "pre_auth_blocked", "code": "worker_readiness_failed",
                    "failureKind": "blocked", "workerFailurePhase": "runtime_ready",
                    "workerFailureKind": kind,
                    "workerBinaryProof": p.WORKER_BINARY_PROOF,
                    "nativeExecuted": False,
                    "authenticated": False, "credentialAdmission": False,
                }
                projected = p.escaped_error_projection(p.FinalizationFailure(
                    p.finalization_projection(
                        report, PermissionError("FICTIONAL_NATIVE_SECRET_18")
                    )
                ))
                self.assertEqual(projected["status"], "cleanup_failed")
                self.assertEqual(projected["code"], "worker_readiness_failed")
                self.assertEqual(projected["failureKind"], "blocked")
                self.assertEqual(projected["workerFailurePhase"], "runtime_ready")
                self.assertEqual(projected["workerFailureKind"], kind)
                self.assertEqual(projected["workerBinaryProof"], p.WORKER_BINARY_PROOF)
                self.assertEqual(
                    projected["cleanupFailureCodes"],
                    ["cleanup_finalization_permission_denied"],
                )
                self.assertFalse(projected["cleanupComplete"])
                self.assertFalse(projected["nativeExecuted"])
                self.assertFalse(projected["authenticated"])
                self.assertFalse(projected["credentialAdmission"])
                p.apply_execute_outcome(projected, "success")
                self.assertEqual(projected["status"], "cleanup_failed")
                self.assertFalse(projected["credentialAdmission"])
                self.assertTrue(
                    "FICTIONAL_NATIVE_SECRET_18" not in json.dumps(projected)
                )

    def test_native_enum_refuses_raw_fields_unknown_and_partial_labels(self):
        for kind in self.NEW_KINDS:
            with self.subTest(kind=kind):
                frame = {"phase": "runtime_ready", "kind": kind}
                for extra in [
                    {"stderr": "FICTIONAL_NATIVE_SECRET_18"},
                    {"message": self.NO_SUCH_MODULE},
                ]:
                    with self.assertRaisesRegex(p.Blocked, "worker_projection_invalid"):
                        p.parse_worker_frame(json.dumps({**frame, **extra}).encode())
                for invalid in [
                    kind + "_extra", True, [], "FICTIONAL_NATIVE_SECRET_18"
                ]:
                    with self.assertRaisesRegex(p.Blocked, "worker_projection_invalid"):
                        p.parse_worker_frame(
                            json.dumps({**frame, "kind": invalid}).encode()
                        )
                with self.assertRaisesRegex(
                    p.Blocked, "worker_failure_projection_invalid"
                ):
                    p.public_report({
                        "workerFailureKind": kind,
                        "authenticated": False, "credentialAdmission": False,
                    })


if __name__ == "__main__":
    unittest.main()


class CFMetadataIsolationTests(unittest.TestCase):
    """Source-only CF setup checks; no SDK import or native runtime."""

    # Exact public SDK functions; encoding retains bytes without hosted cache paths.
    SDK_INDEX_SHA = (
        "94a3497071b11b9382c333d740fdbdfc57491cc56924bda0b506d4dee1621b02"
    )
    SDK_SLICE_SHA = (
        "7525351a38a9460810391f58b5093646cb667de6728a679843085fe4d386324a"
    )
    SDK_PUBLIC_B64 = (
        "ZnVuY3Rpb24gaXNDZkZldGNoRGlzYWJsZWRCeUVudigpIHsKICBjb25zdCBlbnZWYWx1ZSA9"
        "IHByb2Nlc3MuZW52W0NGX0ZFVENIX0VOQUJMRURfRU5WX1ZBUl07CiAgaWYgKGVudlZhbHVl"
        "ID09PSB2b2lkIDApIHsKICAgIHJldHVybiBmYWxzZTsKICB9CiAgcmV0dXJuIGVudlZhbHVl"
        "LnRvTG93ZXJDYXNlKCkgPT09ICJmYWxzZSI7Cn0KZnVuY3Rpb24gZ2V0Q2ZQYXRoRnJvbUVu"
        "digpIHsKICBjb25zdCBlbnZWYWx1ZSA9IHByb2Nlc3MuZW52W0NGX0ZFVENIX1BBVEhfRU5W"
        "X1ZBUl07CiAgaWYgKGVudlZhbHVlID09PSB2b2lkIDAgfHwgZW52VmFsdWUgPT09ICIiKSB7"
        "CiAgICByZXR1cm4gdm9pZCAwOwogIH0KICByZXR1cm4gZW52VmFsdWU7Cn0KZnVuY3Rpb24g"
        "Z2V0Q2ZPcHRpb25XaXRoRW52T3ZlcnJpZGUoY2YpIHsKICBpZiAoY2YgIT09IHZvaWQgMCkg"
        "ewogICAgcmV0dXJuIGNmOwogIH0KICBpZiAoaXNDZkZldGNoRGlzYWJsZWRCeUVudigpKSB7"
        "CiAgICByZXR1cm4gZmFsc2U7CiAgfQogIGNvbnN0IGN1c3RvbVBhdGggPSBnZXRDZlBhdGhG"
        "cm9tRW52KCk7CiAgaWYgKGN1c3RvbVBhdGggIT09IHZvaWQgMCkgewogICAgcmV0dXJuIGN1"
        "c3RvbVBhdGg7CiAgfQogIHJldHVybiB2b2lkIDA7Cn0KYXN5bmMgZnVuY3Rpb24gc2V0dXBD"
        "Zihsb2cyLCBjZikgewogIGNvbnN0IGVmZmVjdGl2ZUNmID0gZ2V0Q2ZPcHRpb25XaXRoRW52"
        "T3ZlcnJpZGUoY2YpOwogIGlmICghKGVmZmVjdGl2ZUNmID8/IHByb2Nlc3MuZW52Lk5PREVf"
        "RU5WICE9PSAidGVzdCIpKSB7CiAgICByZXR1cm4gZmFsbGJhY2tDZjsKICB9CiAgaWYgKHR5"
        "cGVvZiBlZmZlY3RpdmVDZiA9PT0gIm9iamVjdCIpIHsKICAgIHJldHVybiBlZmZlY3RpdmVD"
        "ZjsKICB9CiAgbGV0IGNmUGF0aCA9IGdldERlZmF1bHRDZlBhdGgoKTsKICBpZiAodHlwZW9m"
        "IGVmZmVjdGl2ZUNmID09PSAic3RyaW5nIikgewogICAgY2ZQYXRoID0gZWZmZWN0aXZlQ2Y7"
        "CiAgfQogIHRyeSB7CiAgICBjb25zdCBzdG9yZWRDZiA9IEpTT04ucGFyc2UoYXdhaXQgKDAs"
        "IGltcG9ydF9wcm9taXNlczMucmVhZEZpbGUpKGNmUGF0aCwgInV0ZjgiKSk7CiAgICBjb25z"
        "dCBjZlN0YXQgPSBhd2FpdCAoMCwgaW1wb3J0X3Byb21pc2VzMy5zdGF0KShjZlBhdGgpOwog"
        "ICAgKDAsIGltcG9ydF9ub2RlX2Fzc2VydDMuZGVmYXVsdCkoRGF0ZS5ub3coKSAtIGNmU3Rh"
        "dC5tdGltZU1zIDw9IENGX0RBWVMgKiBEQVkpOwogICAgcmV0dXJuIHN0b3JlZENmOwogIH0g"
        "Y2F0Y2ggewogIH0KICB0cnkgewogICAgY29uc3QgcmVzID0gYXdhaXQgKDAsIGltcG9ydF91"
        "bmRpY2kyLmZldGNoKShkZWZhdWx0Q2ZGZXRjaEVuZHBvaW50LCB7CiAgICAgIHNpZ25hbDog"
        "QWJvcnRTaWduYWwudGltZW91dCgzZTMpCiAgICB9KTsKICAgIGNvbnN0IGNmVGV4dCA9IGF3"
        "YWl0IHJlcy50ZXh0KCk7CiAgICBjb25zdCBzdG9yZWRDZiA9IEpTT04ucGFyc2UoY2ZUZXh0"
        "KTsKICAgIGF3YWl0ICgwLCBpbXBvcnRfcHJvbWlzZXMzLm1rZGlyKShpbXBvcnRfbm9kZV9w"
        "YXRoNS5kZWZhdWx0LmRpcm5hbWUoY2ZQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7CiAg"
        "ICBhd2FpdCAoMCwgaW1wb3J0X3Byb21pc2VzMy53cml0ZUZpbGUpKGNmUGF0aCwgY2ZUZXh0"
        "LCAidXRmOCIpOwogICAgbG9nMi5kZWJ1ZygiVXBkYXRlZCBgUmVxdWVzdC5jZmAgb2JqZWN0"
        "IGNhY2hlISIpOwogICAgcmV0dXJuIHN0b3JlZENmOwogIH0gY2F0Y2ggKGUpIHsKICAgIGxv"
        "ZzIud2FybigKICAgICAgIlVuYWJsZSB0byBmZXRjaCB0aGUgYFJlcXVlc3QuY2ZgIG9iamVj"
        "dCEgRmFsbGluZyBiYWNrIHRvIGEgZGVmYXVsdCBwbGFjZWhvbGRlci4uLlxuIiArIGRpbTIo"
        "ZS5jYXVzZSA/IGUuY2F1c2Uuc3RhY2sgOiBlLnN0YWNrKQogICAgKTsKICAgIHJldHVybiBm"
        "YWxsYmFja0NmOwogIH0KfQo="
    )
    SDK_PUBLIC_SOURCE = base64.b64decode(SDK_PUBLIC_B64).decode("utf-8")
    CF_HARNESS = r"""
const vm = require('node:vm');
const optionContext = {
  scriptPath: '/fictional/worker.mjs', root: '/fictional',
  join: (...parts) => parts.join('/'), randomUUID: () => 'fictional-uuid',
  randomBytes: () => ({toString: () => '0'.repeat(64)}),
  Log: class { constructor(level) { this.level = level; } },
  LogLevel: {NONE: 0},
};
const options = vm.runInNewContext('(' + cfg.options + ')',
  optionContext, {timeout: 1000});
const counts = {
  env: 0, defaultPath: 0, readFile: 0, stat: 0, assert: 0,
  fetch: 0, timeout: 0, mkdir: 0, writeFile: 0, dirname: 0,
  debug: 0, warn: 0,
};
const paths = [];
const poisoned = (key) => {
  counts[key]++;
  throw new Error('fictional_poison_' + key);
};
const callback = (key, body) => (...args) => {
  counts[key]++;
  if (cfg.poison === 'callbacks')
    throw new Error('fictional_poison_' + key);
  return body(...args);
};
const property = (object, key, body) => Object.defineProperty(object, key, {
  get() {
    if (cfg.poison === 'getters') return poisoned(key);
    return callback(key, body);
  },
});
const proc = {};
Object.defineProperty(proc, 'env', {get() {
  if (cfg.poison === 'getters') return poisoned('env');
  counts.env++;
  return cfg.env;
}});
const fallback = Object.freeze({fixture: 'fallback'});
const now = 9000000000;
const io = {};
property(io, 'readFile', async (path, encoding) => {
  paths.push(path);
  if (encoding !== 'utf8') throw new Error('fictional_encoding');
  if (cfg.cache === 'miss') throw new Error('fictional_cache_miss');
  return cfg.cache === 'invalid' ? '{invalid' : '{"fixture":"cache"}';
});
property(io, 'stat', async () => ({
  mtimeMs: cfg.cache === 'stale' ? now - 31 * 864e5 : now,
}));
property(io, 'mkdir', async () => undefined);
property(io, 'writeFile', async () => {
  if (cfg.writeFailure) throw new Error('fictional_write_failure');
});
const http = {};
property(http, 'fetch', async () => {
  if (cfg.fetchFailure) throw new Error('fictional_fetch_failure');
  return {text: async () => '{"fixture":"fetched"}'};
});
const log = {};
property(log, 'debug', () => undefined);
property(log, 'warn', () => undefined);
const context = {
  process: proc, fallbackCf: fallback, import_promises3: io,
  import_undici2: http,
  CF_FETCH_ENABLED_ENV_VAR: 'CLOUDFLARE_CF_FETCH_ENABLED',
  CF_FETCH_PATH_ENV_VAR: 'CLOUDFLARE_CF_FETCH_PATH',
  CF_DAYS: 30, DAY: 864e5, Date: {now: () => now},
  defaultCfFetchEndpoint: 'https://fictional.invalid/cf.json',
  dim2: () => 'fictional_failure',
  import_node_assert3: {default: callback('assert', (valid) => {
    if (!valid) throw new Error('fictional_stale_cache');
  })},
  import_node_path5: {default: {dirname: callback('dirname',
    (path) => path.slice(0, path.lastIndexOf('/')))}},
  AbortSignal: {timeout: callback('timeout', () => ({}))},
};
Object.defineProperty(context, 'getDefaultCfPath', {get() {
  if (cfg.poison === 'getters') return poisoned('defaultPath');
  return callback('defaultPath', () => '/fictional/cache/cf.json');
}});
const setup = vm.runInNewContext(cfg.sdk + '\nsetupCf;', context,
  {timeout: 1000});
let cf;
if (cfg.kind === 'actual' || cfg.kind === 'old_actual') cf = options.cf;
if (cfg.kind === 'false') cf = false;
if (cfg.kind === 'true') cf = true;
if (cfg.kind === 'string') cf = '/fictional/custom-cf.json';
(async () => {
  try {
    const result = await setup(log, cf);
    process.stdout.write(JSON.stringify({
      fallback: result === fallback, value: result, counts, paths, error: null,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      fallback: false, counts, paths, error: error.message,
    }));
  }
})();
"""

    OPTIONS18_SHA = (
        "3f10773edec38e13f7211215efc6c85736953fe355b082184f8aff102b6e5dfa"
    )

    def actual_options_source(self):
        import re

        source = (p.HERE / "worker.mjs").read_text()
        marker = "const runtime = new Miniflare("
        self.assertEqual(source.count(marker), 1)
        match = re.search(
            r"const runtime = new Miniflare\((\{[\s\S]*?\n  \})\)", source
        )
        self.assertIsNotNone(match)
        options = match.group(1)
        self.assertLess(len(options.encode()), 4096)
        return options

    def run_pure_node(self, script):
        import shutil

        node = shutil.which("node")
        self.assertIsNotNone(node, "the pinned Node 22 fixture runner is required")
        result = p.subprocess.run(
            [node, "--input-type=commonjs", "-e", script],
            env={"PATH": "/usr/bin:/bin"},
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def actual_options(self):
        expression = json.dumps(self.actual_options_source())
        return self.run_pure_node("""
const vm = require('node:vm');
const context = {
  scriptPath: '/fictional/worker.mjs', root: '/fictional',
  join: (...parts) => parts.join('/'), randomUUID: () => 'fictional-uuid',
  randomBytes: () => ({toString: () => '0'.repeat(64)}),
  Log: class { constructor(level) { this.level = level; } },
  LogLevel: {NONE: 0},
};
const options = vm.runInNewContext('(' + """ + expression + """ + ')',
  context, {timeout: 1000});
process.stdout.write(JSON.stringify({
  ownsCf: Object.hasOwn(options, 'cf'), value: options.cf ?? null,
}));
""")

    def test_actual_miniflare_options_explicitly_disable_cf_metadata(self):
        options = self.actual_options()
        self.assertTrue(options["ownsCf"])
        self.assertIs(options["value"], False)

    def test_whole_options_object_inverse_preserves_source18(self):
        options = self.actual_options_source()
        self.assertLessEqual(options.count("    cf: false,\n"), 1)
        inverse = options.replace("    cf: false,\n", "")
        self.assertEqual(
            hashlib.sha256(inverse.encode()).hexdigest(), self.OPTIONS18_SHA
        )

    def cf_probe(
        self, kind="actual", *, env=None, cache="miss",
        poison=None, fetch_failure=False, write_failure=False,
    ):
        options = self.actual_options_source()
        if kind == "old_actual":
            options = options.replace("    cf: false,\n", "")
        payload = {
            "options": options, "sdk": self.SDK_PUBLIC_SOURCE,
            "kind": kind, "env": {} if env is None else env,
            "cache": cache, "poison": poison,
            "fetchFailure": fetch_failure, "writeFailure": write_failure,
        }
        script = "const cfg = " + json.dumps(payload) + ";\n" + self.CF_HARNESS
        return self.run_pure_node(script)

    def test_public_sdk_fixture_has_exact_pinned_function_bytes(self):
        self.assertEqual(len(self.SDK_PUBLIC_SOURCE.encode()), 1907)
        self.assertEqual(
            hashlib.sha256(self.SDK_PUBLIC_SOURCE.encode()).hexdigest(),
            self.SDK_SLICE_SHA,
        )
        self.assertEqual(len(self.SDK_INDEX_SHA), 64)
        for name in [
            "isCfFetchDisabledByEnv", "getCfPathFromEnv",
            "getCfOptionWithEnvOverride", "setupCf",
        ]:
            self.assertEqual(
                self.SDK_PUBLIC_SOURCE.count("function " + name + "("), 1
            )

    def test_actual_cf_returns_fallback_before_poisoned_dependencies(self):
        for poison in ["getters", "callbacks"]:
            with self.subTest(poison=poison):
                result = self.cf_probe(poison=poison)
                self.assertIsNone(result["error"])
                self.assertTrue(result["fallback"])
                self.assertEqual(set(result["counts"].values()), {0})
                self.assertEqual(result["paths"], [])

    def test_explicit_false_bypasses_poisoned_environment_overrides(self):
        result = self.cf_probe(
            "false", poison="getters",
            env={
                "NODE_ENV": "production",
                "CLOUDFLARE_CF_FETCH_ENABLED": "true",
                "CLOUDFLARE_CF_FETCH_PATH": "/fictional/poisoned-cf.json",
            },
        )
        self.assertIsNone(result["error"])
        self.assertTrue(result["fallback"])
        self.assertEqual(set(result["counts"].values()), {0})

    def test_old_missing_true_string_controls_attempt_cache_and_fetch(self):
        for kind in ["old_actual", "missing", "true", "string"]:
            with self.subTest(kind=kind):
                result = self.cf_probe(kind, fetch_failure=True)
                self.assertIsNone(result["error"])
                self.assertTrue(result["fallback"])
                for key in ["defaultPath", "readFile", "fetch", "timeout", "warn"]:
                    self.assertEqual(result["counts"][key], 1)
                self.assertEqual(result["counts"]["writeFile"], 0)
                expected = (
                    "/fictional/custom-cf.json" if kind == "string"
                    else "/fictional/cache/cf.json"
                )
                self.assertEqual(result["paths"], [expected])

    def test_test_env_disable_mask_missing_but_not_explicit_true(self):
        for env in [
            {"NODE_ENV": "test"},
            {"CLOUDFLARE_CF_FETCH_ENABLED": "false"},
        ]:
            with self.subTest(env=env):
                missing = self.cf_probe("missing", env=env)
                self.assertTrue(missing["fallback"])
                self.assertEqual(missing["counts"]["readFile"], 0)
                self.assertEqual(missing["counts"]["fetch"], 0)
                explicit = self.cf_probe("true", env=env, fetch_failure=True)
                self.assertTrue(explicit["fallback"])
                self.assertEqual(explicit["counts"]["readFile"], 1)
                self.assertEqual(explicit["counts"]["fetch"], 1)

    def test_fresh_cache_reads_stat_and_skips_fetch_and_writes(self):
        for kind in ["missing", "true", "string"]:
            with self.subTest(kind=kind):
                result = self.cf_probe(kind, cache="fresh")
                self.assertIsNone(result["error"])
                self.assertFalse(result["fallback"])
                self.assertEqual(result["value"], {"fixture": "cache"})
                for key in ["readFile", "stat", "assert"]:
                    self.assertEqual(result["counts"][key], 1)
                for key in ["fetch", "timeout", "mkdir", "writeFile", "warn"]:
                    self.assertEqual(result["counts"][key], 0)

    def test_stale_invalid_cache_fetches_and_writes_fictional_metadata(self):
        for cache in ["stale", "invalid"]:
            with self.subTest(cache=cache):
                result = self.cf_probe("true", cache=cache)
                self.assertIsNone(result["error"])
                self.assertFalse(result["fallback"])
                self.assertEqual(result["value"], {"fixture": "fetched"})
                for key in ["readFile", "fetch", "timeout", "mkdir", "writeFile"]:
                    self.assertEqual(result["counts"][key], 1)
                self.assertEqual(result["counts"]["debug"], 1)
                self.assertEqual(result["counts"]["warn"], 0)

    def test_fetch_write_failures_return_fallback_in_full_sdk_branch(self):
        for failure in ["fetch_failure", "write_failure"]:
            with self.subTest(failure=failure):
                result = self.cf_probe("true", **{failure: True})
                self.assertIsNone(result["error"])
                self.assertTrue(result["fallback"])
                self.assertEqual(result["counts"]["readFile"], 1)
                self.assertEqual(result["counts"]["fetch"], 1)
                self.assertEqual(result["counts"]["warn"], 1)
                self.assertEqual(result["counts"]["debug"], 0)
                self.assertEqual(
                    result["counts"]["writeFile"],
                    1 if failure == "write_failure" else 0,
                )


class WorkerDifferentialTests(unittest.TestCase):
    """Pure controls for the two worker roles and their one shared input."""

    def patch_stack(self):
        from contextlib import ExitStack

        return ExitStack()

    def test_shared_fixture_seed_and_encoding_abi(self):
        import uuid

        options = p.make_fixture_seed()
        self.assertEqual(
            set(options), {"databaseId", "r2BucketId", "tokenSecret"}
        )
        for key in ["databaseId", "r2BucketId"]:
            self.assertEqual(uuid.UUID(options[key]).version, 4)
        self.assertRegex(options["tokenSecret"], r"^[0-9a-f]{64}$")
        raw = p.encode_fixture_input(options, None)
        expected = {
            "companyBundleSha256": None, "options": options,
            "schema": "honowarden.native-preauth-fixture.v1",
        }
        self.assertEqual(
            raw, json.dumps(
                expected, sort_keys=True, separators=(",", ":"),
                ensure_ascii=True,
            ).encode("ascii"),
        )
        self.assertLessEqual(len(raw), 512)
        self.assertFalse(raw.endswith(b"\n"))

    def test_launcher_worker_input_keeps_stdin_for_exact_worker(self):
        node = "/fictional/node"
        arguments = [
            node, str(p.HERE / "worker.mjs"),
            "/fictional/company", "/fictional/root", "minimal",
        ]
        with self.patch_stack() as stack:
            stack.enter_context(patch.object(launch.sys, "argv", [
                "launch", "--worker-input", *arguments,
            ]))
            stack.enter_context(patch.object(launch, "await_go", return_value=True))
            execute = stack.enter_context(patch.object(launch.os, "execve"))
            opened = stack.enter_context(patch.object(launch.os, "open"))
            duplicated = stack.enter_context(patch.object(launch.os, "dup2"))
            self.assertIn(launch.main(), (None, 0))
        execute.assert_called_once_with(node, arguments, launch.os.environ)
        opened.assert_not_called()
        duplicated.assert_not_called()

    OPTIONS = {
        "databaseId": "11111111-1111-4111-8111-111111111111",
        "r2BucketId": "22222222-2222-4222-8222-222222222222",
        "tokenSecret": "a" * 64,
    }
    BUNDLE_SHA = "b" * 64

    def test_encoder_rejects_wrong_types_keys_uuid_token_and_digest(self):
        bad = [None, [], {**self.OPTIONS, "extra": "private"}]
        for key, value in [
            ("databaseId", "1" * 36), ("r2BucketId", True),
            ("tokenSecret", "A" * 64), ("tokenSecret", "a" * 63),
        ]:
            bad.append({**self.OPTIONS, key: value})
        for options in bad:
            with self.subTest(options=options):
                with self.assertRaises(p.Blocked):
                    p.encode_fixture_input(options, None)
        for digest in [True, 1, "B" * 64, "b" * 63, []]:
            with self.subTest(digest=digest):
                with self.assertRaises(p.Blocked):
                    p.encode_fixture_input(self.OPTIONS, digest)
        raw = p.encode_fixture_input(self.OPTIONS, self.BUNDLE_SHA)
        self.assertEqual(json.loads(raw)["options"], self.OPTIONS)
        self.assertLessEqual(len(raw), 512)

    def test_launcher_worker_input_flag_is_a_closed_exact_worker_gate(self):
        good = [
            "/fictional/node", str(p.HERE / "worker.mjs"),
            "/fictional/company", "/fictional/root", "company",
        ]
        bad = [good + ["extra"]]
        for index, value in [
            (0, "node"), (0, "/fictional/sandbox-exec"),
            (1, "/fictional/worker.mjs"), (2, "company"),
            (3, "root"), (4, "desktop"),
        ]:
            arguments = good.copy()
            arguments[index] = value
            bad.append(arguments)
        for arguments in bad:
            with self.patch_stack() as stack:
                stack.enter_context(self.subTest(arguments=arguments))
                stack.enter_context(patch.object(launch.sys, "argv", [
                    "launch", "--worker-input", *arguments,
                ]))
                stack.enter_context(patch.object(
                    launch, "await_go", return_value=True,
                ))
                execute = stack.enter_context(patch.object(launch.os, "execve"))
                opened = stack.enter_context(patch.object(launch.os, "open"))
                self.assertEqual(launch.main(), 1)
                execute.assert_not_called()
                opened.assert_not_called()

    def test_gated_worker_roles_register_before_go_and_keep_input_open(self):
        for role, mode in [
            ("worker_minimal", "minimal"), ("worker_company", "company"),
        ]:
            with self.subTest(role=role):
                worker = MagicMock(pid=71)
                worker.stdin.closed = False
                state = {"children": []}
                events = []
                identity = {
                    "uid": p.os.getuid(), "pgid": 71, "session": 71,
                    "start": "fictional-public-start",
                }

                def persist(marker, value):
                    self.assertEqual(value["children"][0]["role"], role)
                    events.append("persist")

                worker.stdin.write.side_effect = lambda _: events.append("go")
                with self.patch_stack() as stack:
                    opened = stack.enter_context(patch.object(
                        p.subprocess, "Popen", return_value=worker,
                    ))
                    stack.enter_context(patch.object(
                        p, "process_identity", return_value=identity,
                    ))
                    stack.enter_context(patch.object(
                        p, "update_private", side_effect=persist,
                    ))
                    stack.enter_context(patch.object(p, "PROCESSES", []))
                    stopped = stack.enter_context(patch.object(p, "stop_group"))
                    p.gated_launch([
                        "/fictional/node", str(p.HERE / "worker.mjs"),
                        "/fictional/company", "/fictional/root", mode,
                    ], role, {}, state, Path("/fictional/marker"), p.subprocess.PIPE)
                self.assertEqual(events, ["persist", "go"])
                command = opened.call_args.args[0]
                self.assertIn("--worker-input", command)
                self.assertIn("node", state["children"][0]["images"])
                self.assertNotIn("sandbox-exec", state["children"][0]["images"])
                worker.stdin.close.assert_not_called()
                stopped.assert_not_called()

    def control_frame(self, raw, clock=10):
        worker = MagicMock()
        worker.poll.return_value = None
        worker.stdout.fileno.return_value = 71
        chunks = iter(bytes([byte]) for byte in raw)
        report = {}
        with self.patch_stack() as stack:
            stack.enter_context(patch.object(p.time, "monotonic", return_value=clock))
            stack.enter_context(patch.object(p, "time_budget", return_value=0.1))
            stack.enter_context(patch.object(
                p.select, "select", return_value=([worker.stdout], [], []),
            ))
            stack.enter_context(patch.object(
                p.os, "read", side_effect=lambda *_: next(chunks, b""),
            ))
            result = p.read_worker_control(worker, 55, report)
        return result, report

    def test_control_frames_are_closed_public_objects_and_chunk_safe(self):
        ack = {"syntheticInput": "ready"}
        canary = {
            "canary": "public_worker_ready",
            "companyBundleSha256": self.BUNDLE_SHA,
            "binary": p.WORKER_BINARY_PROOF,
        }
        ready = {
            "port": 8123, "d1": True, "r2": True, "worker": True,
            "binary": p.WORKER_BINARY_PROOF,
        }
        for frame in [ack, canary, ready]:
            with self.subTest(frame=frame):
                result, report = self.control_frame(
                    json.dumps(frame).encode() + b"\n",
                )
                self.assertEqual(result, frame)
                self.assertNotIn("minimalWorkerControl", report)
        bad = [
            b'{"syntheticInput":"ready","syntheticInput":"ready"}\n',
            b'{"syntheticInput":"ready","tokenSecret":"private"}\n',
            json.dumps({**canary, "companyBundleSha256": "B" * 64}).encode()
            + b"\n",
        ]
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaises(p.Blocked):
                self.control_frame(raw)

    def test_control_eof_limit_deadline_and_failure_phases_stop(self):
        for raw in [b"", b'{"syntheticInput":"ready"}', b"x" * 1025]:
            with self.subTest(raw=raw[:32]), self.assertRaises(p.Blocked):
                self.control_frame(raw)
        with self.assertRaisesRegex(p.Blocked, "worker_readiness_deadline"):
            self.control_frame(b'{"syntheticInput":"ready"}\n', clock=55)
        for phase in [
            "fixture_input", "minimal_http_probe", "minimal_runtime_dispose",
            "bundle_restore",
        ]:
            with self.subTest(phase=phase):
                frame = {"phase": phase, "kind": "error"}
                with self.assertRaisesRegex(p.Blocked, "worker_readiness_failed"):
                    self.control_frame(json.dumps(frame).encode() + b"\n")
        # Exit can happen between the first select and poll. Drain only the
        # already buffered public frame within the original deadline.
        canary = {
            "canary": "public_worker_ready",
            "companyBundleSha256": self.BUNDLE_SHA,
            "binary": p.WORKER_BINARY_PROOF,
        }
        failure = {"phase": "minimal_http_probe", "kind": "error"}
        for frame in [canary, failure, None]:
            with self.subTest(exit_frame=frame):
                worker = MagicMock()
                worker.poll.return_value = 0
                raw = json.dumps(frame).encode() + b"\n" if frame else b""
                chunks = iter(bytes([byte]) for byte in raw)
                calls = []

                def selected(*args):
                    calls.append(args[-1])
                    if len(calls) == 1 or frame is None:
                        return [], [], []
                    return [worker.stdout], [], []

                with self.patch_stack() as stack:
                    stack.enter_context(patch.object(
                        p.time, "monotonic", return_value=10,
                    ))
                    stack.enter_context(patch.object(
                        p, "time_budget", return_value=0.1,
                    ))
                    stack.enter_context(patch.object(
                        p.select, "select", side_effect=selected,
                    ))
                    stack.enter_context(patch.object(
                        p.os, "read", side_effect=lambda *_: next(chunks, b""),
                    ))
                    if frame is canary:
                        self.assertEqual(
                            p.read_worker_control(worker, 55, {}), canary,
                        )
                    else:
                        expected = "worker_readiness_failed" if frame else (
                            "worker_exited_without_readiness"
                        )
                        with self.assertRaisesRegex(p.Blocked, expected):
                            p.read_worker_control(worker, 55, {})
                self.assertEqual(calls[1], 0)

    def pipeline(self, failure=None):
        clock = [10]
        events, launches, sends, handles = [], [], [], []
        report, state = {}, {"children": []}
        ack = {"syntheticInput": "ready"}
        canary = {
            "canary": "public_worker_ready",
            "companyBundleSha256": self.BUNDLE_SHA,
            "binary": p.WORKER_BINARY_PROOF,
        }
        ready = {
            "port": 8123, "d1": True, "r2": True, "worker": True,
            "binary": p.WORKER_BINARY_PROOF,
        }
        frames = iter([ack, canary, ack, ready])

        def gate(arguments, role, env, registry, marker, stdout):
            self.assertEqual(p.STEP_END, 55)
            if role == "worker_company":
                self.assertEqual(events[-1], "retire")
                self.assertEqual(registry["children"], [])
            events.append(role)
            launches.append((arguments, role, env))
            worker = MagicMock(pid=71 + len(handles))
            worker.poll.return_value = None
            worker.stdin.closed = False
            worker.stdin.write.side_effect = lambda raw: sends.append(raw)
            worker.stdin.close.side_effect = lambda: setattr(
                worker.stdin, "closed", True,
            )

            def wait(**kwargs):
                events.append("wait")
                self.assertLessEqual(kwargs["timeout"], 45)
                if failure == "wait_permission":
                    raise PermissionError("fictional")
                return 1 if failure == "nonzero" else 0

            worker.wait.side_effect = wait
            if failure == "input_pipe":
                worker.stdin.write.side_effect = BrokenPipeError("fictional")
            handles.append(worker)
            p.PROCESSES.append(worker)
            registry["children"].append({"pid": worker.pid, "role": role})
            return worker

        def control(worker, end, projection):
            self.assertEqual(end, 55)
            self.assertEqual(p.STEP_END, 55)
            frame = next(frames)
            if len(handles) == 1 and not sends:
                if failure == "ack":
                    return {"syntheticInput": "wrong"}
                if failure == "eof":
                    raise p.Blocked("worker_readiness_eof")
            if frame is canary and failure == "canary":
                return {"canary": "public_worker_ready"}
            return frame

        def stop(worker):
            events.append("reap")
            if failure == "reap_permission":
                raise PermissionError("fictional")
            if failure == "orphan":
                raise p.Blocked("owned_process_stop_unproved")
            if failure == "expired":
                clock[0] = 55

        def persist(marker, registry):
            events.append("retire")
            self.assertEqual(registry["children"], [])
            if failure == "marker":
                raise p.Blocked("marker_retirement_unproved")

        error = result = None
        with self.patch_stack() as stack:
            stack.enter_context(patch.object(p, "STEP_END", 270))
            stack.enter_context(patch.object(p, "PROCESSES", []))
            stack.enter_context(patch.object(
                p.time, "monotonic", side_effect=lambda: clock[0],
            ))
            stack.enter_context(patch.object(
                p, "time_budget", side_effect=lambda cap: cap,
            ))
            stack.enter_context(patch.object(
                p, "make_fixture_seed", return_value=self.OPTIONS.copy(),
            ))
            stack.enter_context(patch.object(p, "gated_launch", side_effect=gate))
            stack.enter_context(patch.object(
                p, "read_worker_control", side_effect=control,
            ))
            stack.enter_context(patch.object(p, "stop_group", side_effect=stop))
            stack.enter_context(patch.object(p, "update_private", side_effect=persist))
            try:
                result = p.run_worker_differential(
                    "/fictional/node", Path("/fictional/company"),
                    Path("/fictional/root"), {"PATH": "/fictional"},
                    state, Path("/fictional/marker"), report,
                )
            except Exception as caught:
                error = caught
            self.assertEqual(p.STEP_END, 270)
            retained = p.PROCESSES.copy()
        return {
            "events": events, "launches": launches, "sends": sends,
            "report": report, "state": state, "handles": handles,
            "retained": retained, "error": error, "result": result,
        }

    def test_two_roles_share_seed_deadline_and_reap_before_second_gate(self):
        result = self.pipeline()
        self.assertIsNone(result["error"])
        self.assertEqual(result["events"], [
            "worker_minimal", "wait", "reap", "retire", "worker_company",
        ])
        documents = [json.loads(raw) for raw in result["sends"]]
        self.assertEqual([row["options"] for row in documents], [
            self.OPTIONS, self.OPTIONS,
        ])
        self.assertEqual([row["companyBundleSha256"] for row in documents], [
            None, self.BUNDLE_SHA,
        ])
        self.assertEqual(result["report"]["minimalWorkerControl"],
                         "public_worker_ready_and_reaped")
        self.assertEqual(result["retained"], result["handles"][1:])
        for worker in result["handles"]:
            worker.stdin.flush.assert_called_once()
            worker.stdin.close.assert_called_once()
        private = json.dumps({
            "launches": result["launches"], "report": result["report"],
            "state": result["state"],
        })
        for value in self.OPTIONS.values():
            self.assertNotIn(value, private)

    def test_nonzero_permission_or_orphan_stops_before_company_launch(self):
        for failure in ["nonzero", "wait_permission", "orphan", "reap_permission"]:
            with self.subTest(failure=failure):
                result = self.pipeline(failure)
                self.assertIsNotNone(result["error"])
                self.assertEqual(len(result["launches"]), 1)
                self.assertNotIn("minimalWorkerControl", result["report"])
                self.assertEqual(len(result["state"]["children"]), 1)

    def test_failed_ack_eof_or_input_pipe_stops_and_keeps_owned_handle(self):
        for failure in ["ack", "eof", "input_pipe"]:
            with self.subTest(failure=failure):
                result = self.pipeline(failure)
                self.assertIsNotNone(result["error"])
                self.assertEqual(len(result["launches"]), 1)
                self.assertEqual(result["sends"], [])
                self.assertEqual(result["retained"], result["handles"])
                result["handles"][0].stdin.close.assert_not_called()

    def test_retirement_marker_write_failure_stops_second_gate(self):
        incomplete = self.pipeline("canary")
        self.assertIsNotNone(incomplete["error"])
        self.assertEqual(len(incomplete["launches"]), 1)
        self.assertNotIn("reap", incomplete["events"])
        result = self.pipeline("marker")
        self.assertIsNotNone(result["error"])
        self.assertEqual(len(result["launches"]), 1)
        self.assertEqual(result["events"][-2:], ["reap", "retire"])

    def test_elapsed_original_window_cannot_be_reset_for_company(self):
        result = self.pipeline("expired")
        self.assertIsInstance(result["error"], p.Blocked)
        self.assertIn("worker_readiness_deadline", str(result["error"]))
        self.assertEqual(len(result["launches"]), 1)

    def test_public_projection_accepts_only_reaped_control_and_no_seed(self):
        report = {"authenticated": False, "credentialAdmission": False}
        allowed = {**report, "minimalWorkerControl":
                   "public_worker_ready_and_reaped"}
        self.assertEqual(p.public_report(allowed), allowed)
        for delta in [
            {"minimalWorkerControl": "public_worker_ready_and_disposed"},
            {"minimalWorkerControl": True}, {"options": self.OPTIONS},
            {"tokenSecret": self.OPTIONS["tokenSecret"]},
        ]:
            with self.subTest(delta=delta), self.assertRaises(p.Blocked):
                p.public_report({**report, **delta})


class WorkerFixtureInputTests(unittest.TestCase):
    """Run only source-extracted pure helpers with fictitious I/O in Node VM."""

    def test_full_worker_initializes_fixture_constants_before_first_startup(self):
        import re

        source = (p.HERE / "worker.mjs").read_text(encoding="utf-8")
        invocation = "\nstartup().catch(emitFailure)"
        self.assertEqual(source.count(invocation), 1)
        self.assertEqual(source[source.index(invocation):].strip(),
                         "startup().catch(emitFailure)")
        before = source[:source.index(invocation)]
        self.assertLess(len(before.encode()), 65536)
        for name in [
            "FIXTURE_SCHEMA", "FIXTURE_LIMIT", "PUBLIC_BUNDLE_LIMIT",
            "MINIMAL_BODY", "MINIMAL_PATH", "MINIMAL_SCRIPT",
        ]:
            self.assertEqual(len(re.findall(
                r"(?m)^const " + name + r"(?: =|\n)", before,
            )), 1)
        # Strip only this closed stdlib import block. No SDK/module evaluation
        # is enabled; the original initialization and startup source stay intact.
        imports = re.compile(
            r"(?m)^import (?:\{[^}]{1,512}\}|[A-Za-z]+) "
            r"from '(node:[a-z_/]+)'\n",
        )
        modules = [match.group(1) for match in imports.finditer(before)]
        self.assertEqual(modules, [
            "node:crypto", "node:child_process", "node:buffer", "node:fs",
            "node:module", "node:fs/promises", "node:path", "node:process",
            "node:perf_hooks", "node:timers", "node:url",
        ])
        prefix = imports.sub("", before)
        self.assertNotRegex(prefix, r"(?m)^import ")
        script = r"""
const vm = require('node:vm')
const assert = require('node:assert/strict')
const prefix = PREFIX
const options = {
  databaseId: '11111111-1111-4111-8111-111111111111',
  r2BucketId: '22222222-2222-4222-8222-222222222222',
  tokenSecret: 'a'.repeat(64),
}
const wire = (sha) => Buffer.from(JSON.stringify({
  companyBundleSha256: sha, options,
  schema: 'honowarden.native-preauth-fixture.v1',
}))
async function main() {
  for (const [mode, raw, expectedAck, expectedRequires] of [
    ['minimal', null, 1, 0], ['company', null, 1, 0],
    ['unknown', null, 0, 0],
    ['minimal', wire(null), 1, 1], ['company', wire('b'.repeat(64)), 1, 1],
  ]) {
    const frames = [], exits = [], counts = { require: 0, imports: 0 }
    const poison = () => { throw Error('unapproved_operation') }
    // The iterator produces bytes or EOF immediately, with no timeout or sleep.
    const stdin = {
      [Symbol.asyncIterator]() {
        let used = false
        return { next() {
          if (used || raw === null) return Promise.resolve({ done: true })
          used = true
          return Promise.resolve({ value: raw, done: false })
        } }
      },
    }
    const sandbox = {
      Buffer, Uint8Array, URL, counts,
      process: {
        argv: ['node', '/fixture/worker.mjs', '/company', '/root', mode],
        stdin, stdout: { write(raw, callback) {
          frames.push(JSON.parse(raw)); if (callback) callback()
        } },
        exit: (code) => exits.push(code), on: poison, getuid: poison,
        get env() { throw Error('environment_not_admitted') },
      },
      resolve: (path) => path, join: (...parts) => parts.join('/'),
      createHash: poison, cryptoRandomUUID: poison, cryptoRandomBytes: poison,
      spawn: poison, constants: {}, mkdir: poison, open: poison,
      readFile: poison, readdir: poison, realpath: poison, stat: poison,
      performance: { now: poison }, clearTimeout: poison, setTimeout: poison,
      pathToFileURL: poison,
    }
    const context = vm.createContext(sandbox)
    vm.runInContext(prefix, context, {
      timeout: 1000,
      importModuleDynamically() { counts.imports++; throw Error('SDK_forbidden') },
    })
    assert.equal(vm.runInContext('FIXTURE_LIMIT', context), 512)
    assert.equal(vm.runInContext('FIXTURE_SCHEMA', context),
      'honowarden.native-preauth-fixture.v1')
    sandbox.createRequire = vm.runInContext(`() => {
      counts.require++; throw new Error('fictional_dependency_boundary')
    }`, context)
    await vm.runInContext('startup().catch(emitFailure)', context, { timeout: 1000 })
    assert.equal(counts.require, expectedRequires)
    assert.equal(counts.imports, 0)
    assert.deepEqual(exits, [1])
    assert.equal(frames.length, expectedAck + 1)
    if (expectedAck) assert.deepEqual(frames[0], { syntheticInput: 'ready' })
    assert.deepEqual(frames.at(-1), { phase: 'fixture_input', kind: 'error' })
    assert.equal(JSON.stringify(frames).includes(options.tokenSecret), false)
  }
  console.log(JSON.stringify({ checked: true }))
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1 })
""".replace("PREFIX", json.dumps(prefix), 1)
        result = CFMetadataIsolationTests.run_pure_node(self, script)
        self.assertEqual(result, {"checked": True})

    def node_helpers(self, checks):
        source = (p.HERE / "worker.mjs").read_text(encoding="utf-8")
        start = source.index("// The synthetic capability is RAM-only")
        end = source.index("function runtimeFailureKind", start)
        helper = source[start:end]
        self.assertLess(len(helper.encode()), 16384)
        branch_start = source.index(
            "  if (mode === 'minimal') {\n    phase = 'minimal_http_probe'",
        )
        branch_end = source.index("  phase = 'd1_migrate'", branch_start)
        branch = source[branch_start:branch_end]
        script = r"""
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const constants = {
  O_RDONLY: 1, O_WRONLY: 2, O_NOFOLLOW: 4, O_CREAT: 8, O_EXCL: 16,
}
const poison = () => { throw Error('unapproved_callback') }
const sandbox = {
  Buffer, Uint8Array, URL, createHash, constants,
  process: { getuid: () => 501 },
  join: (...parts) => parts.join('/'), open: poison,
  cryptoRandomUUID: poison, cryptoRandomBytes: poison,
  sameBinaryStat: (a, b) => [
    'dev', 'ino', 'size', 'mode', 'uid', 'mtimeNs', 'ctimeNs',
  ].every((key) => a[key] === b[key]),
}
const context = vm.createContext(sandbox)
vm.runInContext(HELPER, context, { timeout: 1000 })
const call = (source) => vm.runInContext(source, context, { timeout: 1000 })
const options = {
  databaseId: '11111111-1111-4111-8111-111111111111',
  r2BucketId: '22222222-2222-4222-8222-222222222222',
  tokenSecret: 'a'.repeat(64),
}
const wire = (sha = null) => Buffer.from(JSON.stringify({
  companyBundleSha256: sha, options,
  schema: 'honowarden.native-preauth-fixture.v1',
}))
const normalize = (value) => JSON.parse(JSON.stringify(value))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function memoryFiles(settings = {}) {
  const original = Buffer.from('export default {fetch(){return "public"}};\n')
  const minimal = Buffer.from(call('MINIMAL_SCRIPT'))
  const files = new Map([
    ['/fixture/company-worker.mjs', { bytes: original, ino: 11n }],
    ['/fixture/worker.mjs', { bytes: minimal, ino: 12n }],
  ])
  const events = []
  let writes = 0
  const stat = (entry) => ({
    isFile: () => true, dev: 1n, ino: entry.ino, uid: 501n,
    nlink: 1n, size: BigInt(entry.bytes.length), mode: 0o100600n,
    mtimeNs: 1n, ctimeNs: 1n,
  })
  sandbox.open = async (path, flags, mode) => {
    events.push(['open', path, flags, mode])
    assert.ok(flags & constants.O_NOFOLLOW)
    if (settings.symlink && path.endsWith('company-worker.mjs'))
      throw Error('ELOOP')
    if (flags & constants.O_EXCL) {
      assert.equal(mode, 0o600)
      if (files.has(path)) throw Error('EEXIST')
      files.set(path, { bytes: Buffer.alloc(0), ino: 13n })
    }
    const entry = files.get(path)
    assert.ok(entry)
    let statCalls = 0
    let cursor = 0
    return {
      async stat() {
        statCalls++
        let value = stat(entry)
        if (path.endsWith('company-worker.mjs'))
          value = { ...value, ...settings.backupStat }
        if (settings.readRace && statCalls === 2)
          value.ino += 100n
        if (settings.readNlinkRace && statCalls === 2)
          value.nlink = 2n
        if (settings.writeRace && flags & constants.O_WRONLY)
          value.ino += 100n
        if (settings.writeNlinkRace && flags & constants.O_WRONLY)
          value.nlink = 2n
        return value
      },
      async read(buffer, offset, length, position) {
        events.push(['read', path])
        assert.equal(position, null)
        assert.ok(length <= buffer.length - offset)
        let bytes = entry.bytes
        if (settings.truncated) bytes = bytes.subarray(1)
        if (settings.badReadback && writes && path.endsWith('/worker.mjs'))
          bytes = Buffer.alloc(entry.bytes.length, 120)
        if (settings.growing) bytes = Buffer.concat([bytes, Buffer.from('extra')])
        const count = Math.min(length, bytes.length - cursor, 7)
        if (count > 0) bytes.copy(buffer, offset, cursor, cursor + count)
        cursor += Math.max(0, count)
        return { bytesRead: Math.max(0, count) }
      },
      readFile: poison,
      async chmod(mode) { assert.equal(mode, 0o600) },
      async truncate(size) { assert.equal(size, 0); entry.bytes = Buffer.alloc(0) },
      async writeFile(bytes) {
        events.push(['write', path]); writes++; entry.bytes = Buffer.from(bytes)
      },
      async sync() { events.push(['sync', path]) },
      async close() { events.push(['close', path]) },
    }
  }
  return { files, events, original, minimal, writes: () => writes }
}
async function main() {
  CHECKS
  console.log(JSON.stringify({ checked: true }))
}
main().catch((error) => {
  console.error(error.stack); process.exitCode = 1
})
"""
        script = script.replace("HELPER", json.dumps(helper), 1)
        script = script.replace("CHECKS", checks, 1)
        script = "const branch = " + json.dumps(branch) + ";\n" + script
        result = CFMetadataIsolationTests.run_pure_node(self, script)
        self.assertEqual(result, {"checked": True})

    def test_canonical_minimal_company_input_matches_python_exact_bytes(self):
        minimal = p.encode_fixture_input(WorkerDifferentialTests.OPTIONS, None)
        company = p.encode_fixture_input(
            WorkerDifferentialTests.OPTIONS, "b" * 64,
        )
        checks = r"""
const expected = EXPECTED.map((value) => Buffer.from(value, 'base64'))
assert.ok(wire().equals(expected[0]))
assert.ok(wire('b'.repeat(64)).equals(expected[1]))
const one = sandbox.parseFixtureInput(expected[0], 'minimal')
const two = sandbox.parseFixtureInput(expected[1], 'company')
assert.deepEqual(normalize(one.options), options)
assert.deepEqual(normalize(two.options), options)
assert.equal(one.companyBundleSha256, null)
assert.equal(two.companyBundleSha256, 'b'.repeat(64))
for (const [bytes, mode] of [
  [expected[0], 'company'], [expected[1], 'minimal'], [expected[0], 'legacy'],
]) assert.throws(() => sandbox.parseFixtureInput(bytes, mode))
""".replace("EXPECTED", json.dumps([
            base64.b64encode(raw).decode() for raw in [minimal, company]
        ]))
        self.node_helpers(checks)

    def test_input_rejects_duplicate_noncanonical_poison_and_invalid_utf8(self):
        self.node_helpers(r"""
const text = wire().toString()
const changed = [
  text + '\n', ' ' + text, text + '{}',
  text.replace('"companyBundleSha256":null',
    '"companyBundleSha256":null,"companyBundleSha256":null'),
  text.replace('"schema":', '"extra":false,"schema":'),
  text.replace(options.databaseId, '0'.repeat(36)),
  text.replace(options.tokenSecret, 'A'.repeat(64)),
  text.replace('"companyBundleSha256":null', '"companyBundleSha256":true'),
  text.replace('"schema":"', '"schema":"' + '\ufffd'),
]
for (const value of changed)
  assert.throws(() => sandbox.parseFixtureInput(Buffer.from(value), 'minimal'))
const malformed = Buffer.from(text)
malformed[malformed.indexOf('honowarden')] = 0xff
assert.throws(() => sandbox.parseFixtureInput(malformed, 'minimal'))
assert.throws(() => sandbox.parseFixtureInput(Buffer.alloc(513), 'minimal'))
assert.throws(() => sandbox.parseFixtureInput(new Uint8Array(1), 'minimal'))
let invoked = 0
const poisoned = { ...options }
Object.defineProperty(poisoned, 'tokenSecret', {
  enumerable: true, get() { invoked++; throw Error('private_getter') },
})
assert.throws(() => sandbox.fixtureProviders(poisoned))
assert.equal(invoked, 0)
""")

    def test_chunked_input_waits_eof_and_rejects_oversize_before_next_chunk(self):
        self.node_helpers(r"""
let finish, settled = false
const eof = new Promise((resolve) => { finish = resolve })
const raw = wire()
async function* chunks() {
  yield raw.subarray(0, 17); yield raw.subarray(17); await eof
}
const reading = sandbox.readFixtureInput(chunks(), 'minimal')
reading.then(() => { settled = true })
await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
assert.equal(settled, false)
finish()
assert.deepEqual(normalize((await reading).options), options)
let poisonReached = false
async function* oversized() {
  yield Buffer.alloc(513); poisonReached = true; throw Error('late_poison')
}
await assert.rejects(sandbox.readFixtureInput(oversized(), 'minimal'))
assert.equal(poisonReached, false)
async function* wrongChunk() { yield 'private_text' }
await assert.rejects(sandbox.readFixtureInput(wrongChunk(), 'minimal'))
async function* interrupted() { yield raw; throw Error('stream_failure') }
await assert.rejects(sandbox.readFixtureInput(interrupted(), 'minimal'))
""")

    def test_fixture_providers_use_exact_two_uuids_one_token_and_no_fallback(self):
        self.node_helpers(r"""
const providers = sandbox.fixtureProviders(options)
assert.throws(() => providers.validate())
assert.equal(providers.randomUUID(), options.databaseId)
assert.equal(providers.randomUUID(), options.r2BucketId)
assert.throws(() => providers.randomUUID())
assert.throws(() => providers.validate())
assert.equal(providers.randomBytes(32).toString('hex'), options.tokenSecret)
providers.validate()
assert.throws(() => providers.randomBytes(32))
const wrong = sandbox.fixtureProviders(options)
assert.throws(() => wrong.randomBytes(16))
assert.equal(wrong.randomBytes(32).toString('hex'), options.tokenSecret)
assert.throws(() => wrong.validate())
// Global providers are poisoned in this VM. Determinism cannot fall back to OS.
assert.equal(sandbox.cryptoRandomUUID, poison)
assert.equal(sandbox.cryptoRandomBytes, poison)
""")

    def test_disposer_shares_original_pending_and_rejected_promise_identity(self):
        self.node_helpers(r"""
let calls = 0, resolve
const pending = new Promise((done) => { resolve = done })
const dispose = sandbox.createDisposer({ dispose() { calls++; return pending } })
const first = dispose()
assert.equal(dispose(), first)
await Promise.resolve()
assert.equal(calls, 1)
let settled = false
first.then(() => { settled = true })
await Promise.resolve(); assert.equal(settled, false)
resolve(); await first
assert.equal(dispose(), first); assert.equal(calls, 1)
const error = Error('dispose_failure')
let failedCalls = 0
const failed = sandbox.createDisposer({ dispose() { failedCalls++; throw error } })
const rejection = failed()
assert.equal(failed(), rejection)
await assert.rejects(rejection, (actual) => actual === error)
assert.equal(failed(), rejection); assert.equal(failedCalls, 1)
""")

    def test_http_probe_fixed_path_bounded_body_and_reader_cleanup(self):
        self.node_helpers(r"""
const body = Buffer.from(call('MINIMAL_BODY'))
async function probe(settings = {}) {
  const chunks = settings.chunks || [body.subarray(0, 7), body.subarray(7)]
  let reads = 0, cancels = 0, releases = 0, url
  const reader = {
    async read() {
      if (settings.readFailure) throw Error('read_failure')
      return reads < chunks.length ? { value: chunks[reads++], done: false }
        : { done: true }
    },
    async cancel() {
      cancels++
      if (settings.cancelFailure) throw Error('cancel_failure')
    },
    releaseLock() {
      releases++
      if (settings.releaseFailure) throw Error('release_failure')
    },
  }
  const response = {
    status: settings.status ?? 200,
    headers: { get: () => settings.type ?? 'text/plain' },
    body: settings.noBody ? null : { getReader: () => reader },
    text: poison, arrayBuffer: poison,
  }
  let error
  try {
    await sandbox.probeMinimalHttp({
      async dispatchFetch(value) { url = value; return response },
    }, new URL('http://127.0.0.1:8123/ignored?private=fiction'))
  } catch (caught) { error = caught }
  return { error, cancels, releases, url }
}
const good = await probe()
assert.equal(good.error, undefined)
assert.equal(good.url, 'http://127.0.0.1:8123/__honowarden_public_canary')
assert.equal(good.cancels, 1); assert.equal(good.releases, 1)
for (const settings of [
  { status: 201 }, { type: 'text/plain; charset=utf-8' }, { noBody: true },
  { chunks: [Buffer.alloc(129)] }, { chunks: [body.subarray(1)] },
  { chunks: ['private'] }, { readFailure: true },
]) {
  const bad = await probe(settings)
  assert.ok(bad.error)
  if (!settings.status && !settings.type && !settings.noBody) {
    assert.equal(bad.cancels, 1); assert.equal(bad.releases, 1)
  }
}
for (const settings of [
  { cancelFailure: true }, { releaseFailure: true },
  { cancelFailure: true, releaseFailure: true },
]) {
  const cleanup = await probe(settings)
  assert.ok(cleanup.error)
  assert.equal(cleanup.cancels, 1); assert.equal(cleanup.releases, 1)
  assert.equal(cleanup.error.message,
    settings.cancelFailure ? 'cancel_failure' : 'release_failure')
  const primary = await probe({ ...settings, readFailure: true })
  assert.equal(primary.error.message, 'read_failure')
  assert.equal(primary.cancels, 1); assert.equal(primary.releases, 1)
}
""")

    def test_minimal_branch_emits_no_canary_before_disposal_or_on_rejection(self):
        self.node_helpers(r"""
let resolve, started, calls = 0
const pending = new Promise((done) => { resolve = done })
const disposing = new Promise((done) => { started = done })
const output = [], exits = [], events = []
sandbox.mode = 'minimal'; sandbox.phase = ''
sandbox.companyBundleSha256 = 'b'.repeat(64)
sandbox.binaryProof = 'pinned_darwin_arm64_version_verified'
sandbox.runtime = {}; sandbox.url = new URL('http://127.0.0.1:8123/')
sandbox.probeMinimalHttp = async () => { events.push('http') }
sandbox.dispose = sandbox.createDisposer({
  dispose() { calls++; started(); return pending },
})
sandbox.process.stdout = {
  write(raw, callback) { output.push(JSON.parse(raw)); callback() },
}
sandbox.process.exit = (code) => exits.push(code)
const running = call('(async () => {' + branch + '})()')
await disposing
assert.equal(output.length, 0); assert.equal(exits.length, 0)
assert.equal(calls, 1)
resolve(); await running
assert.deepEqual(events, ['http'])
assert.equal(output.length, 1)
assert.equal(output[0].canary, 'public_worker_ready')
assert.deepEqual(exits, [0])
output.length = 0; exits.length = 0
sandbox.dispose = sandbox.createDisposer({ dispose() { throw Error('failed') } })
await assert.rejects(call('(async () => {' + branch + '})()'))
assert.equal(output.length, 0); assert.equal(exits.length, 0)
""")

    def test_restore_verifies_digest_predecessor_and_exact_public_readback(self):
        self.node_helpers(r"""
let fixture = memoryFiles()
await sandbox.restoreCompanyBundle('/fixture', digest(fixture.original))
assert.equal(fixture.writes(), 1)
assert.ok(fixture.files.get('/fixture/worker.mjs').bytes.equals(fixture.original))
assert.equal(fixture.events.at(-2)[0], 'read')
assert.equal(fixture.events.at(-1)[0], 'close')
fixture = memoryFiles()
await assert.rejects(sandbox.restoreCompanyBundle('/fixture', 'b'.repeat(64)))
assert.equal(fixture.writes(), 0)
assert.equal(fixture.events.filter((row) => row[0] === 'open').length, 1)
fixture = memoryFiles()
fixture.files.get('/fixture/worker.mjs').bytes = Buffer.from('different predecessor')
await assert.rejects(sandbox.restoreCompanyBundle('/fixture', digest(fixture.original)))
assert.equal(fixture.writes(), 0)
fixture = memoryFiles({ badReadback: true })
await assert.rejects(sandbox.restoreCompanyBundle('/fixture', digest(fixture.original)))
assert.equal(fixture.writes(), 1)
// A rejected restore cannot authorize the next SDK constructor.
let constructors = 0
fixture = memoryFiles()
await assert.rejects((async () => {
  await sandbox.restoreCompanyBundle('/fixture', 'b'.repeat(64))
  constructors++
})())
assert.equal(constructors, 0)
""")

    def test_restore_refuses_symlink_permissions_hardlink_size_and_metadata_races(self):
        self.node_helpers(r"""
for (const settings of [
  { symlink: true }, { backupStat: { mode: 0o100644n } },
  { backupStat: { uid: 502n } }, { backupStat: { nlink: 2n } },
  { backupStat: { size: 16777217n } }, { backupStat: { size: 0n } },
  { readRace: true }, { truncated: true }, { growing: true }, { writeRace: true },
  { readNlinkRace: true }, { writeNlinkRace: true },
]) {
  const fixture = memoryFiles(settings)
  await assert.rejects(sandbox.restoreCompanyBundle(
    '/fixture', digest(fixture.original)))
  assert.equal(fixture.writes(), 0)
}
const fixture = memoryFiles()
await assert.rejects(sandbox.restoreCompanyBundle('/fixture', 'B'.repeat(64)))
assert.equal(fixture.events.length, 0)
""")

    def test_prepare_stash_is_exclusive_private_and_minimal_script_is_fixed(self):
        self.node_helpers(r"""
let fixture = memoryFiles()
fixture.files.delete('/fixture/company-worker.mjs')
fixture.files.get('/fixture/worker.mjs').bytes = Buffer.from(fixture.original)
const sha = await sandbox.prepareMinimalBundle('/fixture')
assert.equal(sha, digest(fixture.original))
assert.ok(fixture.files.get('/fixture/company-worker.mjs')
  .bytes.equals(fixture.original))
assert.ok(fixture.files.get('/fixture/worker.mjs').bytes.equals(fixture.minimal))
const created = fixture.events.find((row) => row[0] === 'open' && row[3] === 0o600)
assert.ok(created[2] & constants.O_CREAT)
assert.ok(created[2] & constants.O_EXCL)
fixture = memoryFiles()
await assert.rejects(sandbox.prepareMinimalBundle('/fixture'))
assert.equal(fixture.writes(), 0)
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.init = init }
}
const script = call('MINIMAL_SCRIPT').replace('export default', 'globalThis.worker =')
const minimal = vm.createContext({ URL, Response: FakeResponse })
vm.runInContext(script, minimal, { timeout: 1000 })
for (const [method, path, expected] of [
  ['GET', '/__honowarden_public_canary', 'honowarden-public-native-canary-v1'],
  ['POST', '/__honowarden_public_canary', 'refused'],
  ['GET', '/__honowarden_public_canary?extra=1', 'refused'],
  ['GET', '/other', 'refused'],
]) assert.equal(minimal.worker.fetch({
  method, url: 'http://127.0.0.1:8123' + path,
}).body, expected)
""")
