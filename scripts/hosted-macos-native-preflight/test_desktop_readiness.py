"""Mocked Desktop readiness diagnostics; no native app, keychain or network."""

import ast
import contextlib
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import launch
import preflight as p


class DesktopReadinessTests(unittest.TestCase):
    APP = Path("/owned/extract/Client.app")
    TARGET = {
        "type": "page",
        "url": "file:///owned/extract/Client.app/Contents/Resources/app.asar/index.html",
        "webSocketDebuggerUrl": "ws://127.0.0.1:8124/devtools/page/fictional",
    }

    def test_target_diagnostics_distinguish_loading_from_wrong_bundle_without_urls(self):
        targets = [self.TARGET, {"type": "page", "url": "about:blank"},
                   {"type": "page", "url": "file:///foreign/PRIVATE_MARKER/index.html"},
                   {"type": "page", "url": "https://private.invalid/PRIVATE_MARKER"}]
        summary = p.desktop_target_summary(targets, self.APP)
        self.assertEqual(summary, {"total": 4, "pages": 4, "blankPages": 1,
                                   "filePages": 2, "ownedBundlePages": 1, "ownedIndexPages": 1})
        self.assertNotIn("PRIVATE_MARKER", json.dumps(summary))
        report = {"authenticated": False, "credentialAdmission": False, "desktopTargetSummary": summary}
        p.public_report(report)
        for invalid in [{**summary, "total": 11}, {**summary, "pages": True},
                        {**summary, "url": "PRIVATE_MARKER"}, {**summary, "ownedIndexPages": 2}]:
            with self.assertRaises(p.Blocked):
                p.public_report({**report, "desktopTargetSummary": invalid})

    def test_target_diagnostics_reject_invalid_frames_without_private_exception_text(self):
        for candidates in [[None], [{"type": "page", "url": []}], "PRIVATE_MARKER", [{}] * 11]:
            with self.assertRaises(p.Blocked) as caught:
                p.desktop_target_summary(candidates, self.APP)
            self.assertEqual(str(caught.exception), "cdp_targets_invalid")

    def attempt(self, *, polls=(None, None), listener=None, candidates=None,
                discovery_error=None, deadline=False, retry_error=None):
        report = {"authenticated": False, "credentialAdmission": False}
        proc = MagicMock(pid=42)
        proc.poll.side_effect = list(polls)
        clock = {"now": 100.0}
        observed = {}

        def retry(error):
            clock["now"] += 30 if deadline else 0.25
            if retry_error is not None:
                raise retry_error

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(p.time, "monotonic", side_effect=lambda: clock["now"]))
            stack.enter_context(patch.object(p, "time_budget", side_effect=lambda maximum: maximum))
            observed["retry"] = stack.enter_context(patch.object(p, "readiness_retry", side_effect=retry))
            observed["command"] = stack.enter_context(patch.object(
                p, "command", return_value=(listener or b"p42\nn127.0.0.1:8124\n", 0)))
            if isinstance(listener, Exception):
                observed["command"].side_effect = listener
            observed["http"] = stack.enter_context(patch.object(
                p, "bounded_http", return_value=[self.TARGET] if candidates is None else candidates,
                side_effect=discovery_error))
            try:
                target = p.await_desktop_target(proc, self.APP, 8124, report)
                error = None
            except p.Blocked as caught:
                target, error = None, caught
        return report, target, error, observed

    def test_success_retains_exact_listener_and_renderer_identity(self):
        report, target, error, observed = self.attempt()
        self.assertIsNone(error)
        self.assertEqual(target, self.TARGET)
        self.assertEqual(report["desktopReadinessPhase"], "ready")
        self.assertEqual(report["desktopProcessState"], "running")
        self.assertEqual(report["desktopReadinessFailureKind"], "none")
        observed["command"].assert_called_once_with(
            ["/usr/sbin/lsof", "-nP", "-iTCP:8124", "-sTCP:LISTEN", "-Fpn"], timeout=3)
        observed["http"].assert_called_once_with(8124, "/json/list")
        observed["retry"].assert_not_called()
        self.assertNotIn("fictional", json.dumps(p.public_report(report)))

    def test_exit_before_first_probe_records_exact_bounded_exit(self):
        for code in (0, 1, 127, 255):
            with self.subTest(code=code):
                report, target, error, observed = self.attempt(polls=(code, code))
                self.assertEqual(str(error), "native_cdp_not_ready")
                self.assertIsNone(target)
                self.assertEqual(report["desktopProcessState"], "exited")
                self.assertEqual(report["desktopExitCode"], code)
                self.assertIsNone(report["desktopSignal"])
                self.assertEqual(report["desktopReadinessPhase"], "process_poll")
                self.assertEqual(report["desktopReadinessFailurePhase"], "none")
                observed["command"].assert_not_called()
                p.public_report(report)

    def test_signal_before_first_probe_is_separate_from_exit_code(self):
        report, _, error, _ = self.attempt(polls=(-9, -9))
        self.assertEqual(str(error), "native_cdp_not_ready")
        self.assertEqual(report["desktopProcessState"], "signaled")
        self.assertEqual(report["desktopSignal"], 9)
        self.assertIsNone(report["desktopExitCode"])
        p.public_report(report)

    def test_final_poll_error_does_not_replace_the_original_readiness_failure(self):
        report, _, error, _ = self.attempt(polls=(1, OSError("FICTIONAL_SECRET")))
        self.assertEqual(str(error), "native_cdp_not_ready")
        self.assertEqual(report["desktopProcessState"], "unavailable")
        self.assertIsNone(report["desktopExitCode"])
        self.assertNotIn("FICTIONAL_SECRET", json.dumps(p.public_report(report)))

    def test_unavailable_initial_poll_fails_loudly_before_any_probe(self):
        report, _, error, observed = self.attempt(
            polls=(OSError("FICTIONAL_SECRET"), OSError("FICTIONAL_SECRET")))
        self.assertEqual(str(error), "desktop_process_observation_failed")
        self.assertEqual(report["desktopProcessState"], "unavailable")
        observed["command"].assert_not_called()
        self.assertNotIn("FICTIONAL_SECRET", json.dumps(p.public_report(report)))

    def test_listener_query_failure_then_exit_keeps_last_failed_phase(self):
        report, _, error, observed = self.attempt(
            polls=(None, 1, 1), listener=p.Blocked("command_failed"))
        self.assertEqual(str(error), "native_cdp_not_ready")
        self.assertEqual(report["desktopReadinessPhase"], "process_poll")
        self.assertEqual(report["desktopReadinessFailurePhase"], "listener_query")
        self.assertEqual(report["desktopReadinessFailureKind"], "command_failed")
        self.assertEqual(report["desktopExitCode"], 1)
        observed["http"].assert_not_called()

    def test_wrong_pid_or_wildcard_listener_never_admits_discovery(self):
        for listener in (b"p43\nn127.0.0.1:8124\n", b"p42\nn*:8124\n"):
            with self.subTest(listener=listener):
                report, target, error, observed = self.attempt(listener=listener, deadline=True)
                self.assertIsNone(target)
                self.assertEqual(str(error), "native_cdp_not_ready")
                self.assertEqual(report["desktopReadinessFailurePhase"], "listener_identity")
                self.assertEqual(report["desktopReadinessFailureKind"], "cdp_listener_identity_mismatch")
                observed["http"].assert_not_called()

    def test_foreign_or_duplicate_renderer_never_counts_as_ready(self):
        for candidates in ([{**self.TARGET, "url": "file:///foreign/index.html"}],
                           [{**self.TARGET, "url": "file://foreign/owned/extract/Client.app/Contents/Resources/app.asar/index.html"}],
                           [{**self.TARGET, "url": "file:///owned/extract/Client.app/Contents/Resources/app.asar/../foreign/index.html"}],
                           [self.TARGET, self.TARGET], [], [{**self.TARGET, "type": "worker"}]):
            with self.subTest(candidates=candidates):
                report, target, error, _ = self.attempt(candidates=candidates, deadline=True)
                self.assertIsNone(target)
                self.assertEqual(str(error), "native_cdp_not_ready")
                self.assertEqual(report["desktopReadinessFailurePhase"], "target_identity")
                self.assertEqual(report["desktopReadinessFailureKind"], "desktop_renderer_identity_mismatch")
                self.assertEqual(report["desktopProcessState"], "running")

    def test_discovery_failures_are_closed_and_do_not_copy_exception_payloads(self):
        for error, kind in ((PermissionError("FICTIONAL_SECRET"), "permission_error"),
                            (TimeoutError("https://fictional.invalid/private"), "timeout"),
                            (OSError("FICTIONAL_SECRET"), "os_error"),
                            (ValueError("FICTIONAL_SECRET"), "value_error"),
                            (p.Blocked("FICTIONAL_SECRET"), "blocked_other"),
                            (p.Blocked("cdp_http_limit"), "cdp_http_limit")):
            with self.subTest(kind=kind):
                report, _, caught, _ = self.attempt(discovery_error=error, deadline=True)
                self.assertEqual(str(caught), "native_cdp_not_ready")
                self.assertEqual(report["desktopReadinessFailurePhase"], "target_discovery")
                self.assertEqual(report["desktopReadinessFailureKind"], kind)
                saved = json.dumps(p.public_report(report))
                self.assertNotIn("FICTIONAL_SECRET", saved)
                self.assertNotIn("fictional.invalid", saved)

    def test_blocked_error_with_custom_stringifier_is_not_formatted(self):
        class Unprintable(p.Blocked):
            def __str__(self):
                raise AssertionError("Private exception stringifier invoked")

        report, _, error, _ = self.attempt(discovery_error=Unprintable("FICTIONAL_SECRET"), deadline=True)
        self.assertEqual(str(error), "native_cdp_not_ready")
        self.assertEqual(report["desktopReadinessFailureKind"], "blocked_other")

    def test_absolute_deadline_escapes_without_becoming_cdp_timeout(self):
        error = p.Blocked("absolute_step_deadline")
        report, _, caught, _ = self.attempt(discovery_error=error, retry_error=error)
        self.assertIs(caught, error)
        self.assertEqual(report["desktopReadinessFailureKind"], "absolute_step_deadline")

    def test_last_failure_survives_subsequent_success(self):
        report, target, error, _ = self.attempt(
            polls=(None, None, None), discovery_error=[ValueError("FICTIONAL_SECRET"), [self.TARGET]])
        self.assertIsNone(error)
        self.assertEqual(target, self.TARGET)
        self.assertEqual(report["desktopReadinessPhase"], "ready")
        self.assertEqual(report["desktopReadinessFailurePhase"], "target_discovery")
        self.assertEqual(report["desktopReadinessFailureKind"], "value_error")

    def test_invalid_process_observation_fails_without_copying_its_value(self):
        for value in (True, "FICTIONAL_SECRET", 256, -128, [], object()):
            with self.subTest(category=type(value).__name__):
                report, _, error, observed = self.attempt(polls=(value, value))
                self.assertEqual(str(error), "desktop_process_projection_invalid")
                self.assertEqual(report["desktopProcessState"], "invalid")
                self.assertIsNone(report["desktopExitCode"])
                self.assertIsNone(report["desktopSignal"])
                observed["command"].assert_not_called()
                self.assertNotIn("FICTIONAL_SECRET", json.dumps(p.public_report(report)))

    def test_closed_projection_rejects_partial_unknown_and_inconsistent_values(self):
        report, _, _, _ = self.attempt()
        changes = [
            {"desktopReadinessPhase": "FICTIONAL_SECRET"},
            {"desktopReadinessFailurePhase": "https://fictional.invalid"},
            {"desktopReadinessFailureKind": []},
            {"desktopProcessState": True},
            {"desktopExitCode": 0},
            {"desktopSignal": 9},
            {"desktopProcessState": "exited", "desktopExitCode": True},
            {"desktopProcessState": "exited", "desktopExitCode": 256},
            {"desktopProcessState": "signaled", "desktopSignal": -9},
            {"desktopProcessState": "signaled", "desktopSignal": 128},
            {"desktopReadinessFailurePhase": "listener_query"},
            {"desktopReadinessFailureKind": "command_failed"},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(p.Blocked):
                p.public_report({**report, **change})
        for key in p.DESKTOP_DIAGNOSTIC_KEYS:
            with self.subTest(missing=key), self.assertRaises(p.Blocked):
                p.public_report({k: v for k, v in report.items() if k != key})

    def test_cleanup_failure_preserves_first_failure_and_desktop_metadata(self):
        report, _, _, _ = self.attempt(polls=(-6, -6))
        report.update(code="native_cdp_not_ready", failureKind="blocked", nativeExecuted=True)
        carried = p.FinalizationFailure(p.finalization_projection(report, OSError("FICTIONAL_SECRET")))
        projected = p.escaped_error_projection(carried)
        self.assertEqual(projected["code"], "native_cdp_not_ready")
        self.assertEqual(projected["desktopSignal"], 6)
        self.assertEqual(projected["status"], "cleanup_failed")
        self.assertFalse(projected["cleanupComplete"])
        self.assertFalse(projected["authenticated"])
        self.assertNotIn("FICTIONAL_SECRET", json.dumps(projected))

    def test_execute_uses_diagnostic_wait_before_asserting_listener_readiness(self):
        tree = ast.parse((p.HERE / "preflight.py").read_text())
        execute = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "execute")
        source = ast.unparse(execute)
        self.assertIn("target = await_desktop_target(app_proc, app, cdp_port, report)", source)
        self.assertLess(source.index("await_desktop_target("), source.index("report['appListenerOwned'] = True"))
        self.assertIn("capture_desktop_log(app_proc)", source)
        self.assertIn("report['desktopLogSummary'] = dict(desktop_log.summary)", source)


class DesktopLaunchTests(unittest.TestCase):
    def test_desktop_gate_redirects_stdin_before_exact_exec(self):
        arguments = ["/usr/bin/sandbox-exec", "-f", "/owned/network.sb", "/owned/Client"]
        events = []
        with patch.object(launch, "await_go", return_value=True), \
             patch.object(launch.sys, "argv", ["launch", *arguments]), \
             patch.object(launch.os, "open", return_value=7) as opened, \
             patch.object(launch.os, "dup2", side_effect=lambda *args: events.append(("dup2", args))), \
             patch.object(launch.os, "close", side_effect=lambda *args: events.append(("close", args))), \
             patch.object(launch.os, "execve", side_effect=lambda *args: events.append(("execve", args))):
            launch.main()
        opened.assert_called_once_with(launch.os.devnull, launch.os.O_RDONLY)
        self.assertEqual(events[:2], [("dup2", (7, 0)), ("close", (7,))])
        self.assertEqual(events[2], ("execve", (arguments[0], arguments, launch.os.environ)))

    def test_closed_gate_never_opens_null_or_executes(self):
        with patch.object(launch, "await_go", return_value=False), \
             patch.object(launch.os, "open") as opened, patch.object(launch.os, "execve") as execute:
            self.assertEqual(launch.main(), 1)
        opened.assert_not_called()
        execute.assert_not_called()
