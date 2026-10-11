import importlib.util
from pathlib import Path
import unittest
import io
import json
from contextlib import nullcontext, redirect_stdout
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("network_inspect", Path(__file__).with_name("packet_filter.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class InspectionTests(unittest.TestCase):
    def test_no_local_or_self_hosted_execution(self):
        for env in [{}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}]:
            with self.assertRaises(p.Blocked):
                p.require_host(env, "darwin")

    def test_closed_read_selectors_do_not_accept_mutations(self):
        with patch.object(p.subprocess, "run") as run:
            for operation in ["enable", "-f", "-F", "-X", "rules;bad", ""]:
                with self.assertRaises(p.Blocked):
                    p.command(operation)
            run.assert_not_called()

    def test_projection_preserves_risk_signals_without_raw_rules(self):
        value = dict(rules='anchor "com.apple/*" all\n', status="Status: Disabled for 0 days\n",
                     anchors="com.apple\n", interfaces="lo0\n\tCleared: 0\n\tReferences: 0\nen0\n\tCleared: 0\n")
        result = p.project(value)
        self.assertTrue(result["onlyAppleWildcardAnchor"])
        self.assertFalse(result["packetFilterEnabled"])
        self.assertFalse(result["loopbackSkip"])
        self.assertEqual(result["anchorCount"], 1)
        value["interfaces"] = "lo0 (skip)\n\tCleared: 0\n"
        self.assertTrue(p.project(value)["loopbackSkip"])
        value["rules"] += "pass all # FICTIONAL_PRIVATE_VALUE\n"
        result = p.project(value)
        self.assertFalse(result["onlyAppleWildcardAnchor"])
        self.assertNotIn("FICTIONAL_PRIVATE_VALUE", str(result))
        value["status"] = "unknown"
        with self.assertRaises(p.Blocked):
            p.project(value)

    def test_filter_policy_has_only_two_local_ports_and_rejects_injection(self):
        rules = p.filter_rules(501, [8123, 8124])
        self.assertIn("on lo0 inet proto tcp", rules)
        self.assertIn("port { 8123, 8124 } user 501 no state", rules)
        self.assertIn("block return out quick proto { tcp, udp } from any to any user 501", rules)
        for uid, ports in [(0, [8123, 8124]), (True, [8123, 8124]), (501, [8123, 8123]),
                           (501, [8123, 80]), (501, [8123, "8124;pass all"]), (501, [8123, 8124, 8125])]:
            with self.assertRaises(p.Blocked):
                p.filter_rules(uid, ports)

    def test_native_control_requires_host_before_privileged_calls(self):
        with patch.object(p.os, "environ", {}), patch.object(p, "pf") as pf:
            with self.assertRaises(p.Blocked):
                p.control()
            pf.assert_not_called()

    def run_control(self, fail_enable=False, drift=False):
        values = dict(rules='anchor "com.apple/*" all\n', status="Status: Disabled for 0 days\n",
                      anchors="com.apple\n", interfaces="lo0\n\tReferences: 0\n")
        events = []
        reads = []
        def read(operation):
            reads.append(operation)
            if drift and operation == "rules" and reads.count("rules") == 3:
                return "block all\n"
            return values[operation]
        def pf(args, data=None):
            events.append(args)
            if args == ["-E"]:
                if fail_enable:
                    raise p.Blocked("packet_filter_operation_failed")
                return b"", b"Token : 123\n"
            return b"", b""
        sockets = []
        for port in [8123, 8125, 8124]:
            sock = MagicMock()
            sock.getsockname.return_value = ("127.0.0.1", port)
            sock.__enter__.return_value = sock
            sockets.append(sock)
        output = io.StringIO()
        with patch.object(p, "require_host"), patch.object(p, "command", side_effect=read), \
             patch.object(p, "pf", side_effect=pf), patch.object(p.os, "getuid", return_value=501), \
             patch.object(p.socket, "socket", side_effect=sockets), \
             patch.object(p.socket, "create_connection", side_effect=[nullcontext(), nullcontext(), nullcontext(), OSError()]), \
             patch.object(p.signal, "signal"), patch.object(p.signal, "alarm"), redirect_stdout(output):
            code = p.control()
        return code, json.loads(output.getvalue()), events

    def test_native_control_removes_only_its_anchor_and_releases_its_reference(self):
        code, report, events = self.run_control()
        self.assertEqual(code, 0)
        self.assertTrue(report["allowed"] and report["denied"] and report["cleanup"])
        self.assertIn(["-X", "123"], events)
        flushes = [row for row in events if "-F" in row]
        self.assertEqual(len(flushes), 1)
        self.assertEqual(flushes[0][0], "-a")
        self.assertTrue(flushes[0][1].startswith("com.apple/honowarden-"))
        self.assertEqual(flushes[0][2:], ["-F", "rules"])
        self.assertFalse(any("-d" in row or "all" in row for row in events))

    def test_enable_failure_still_removes_owned_rules_without_inventing_a_token(self):
        code, report, events = self.run_control(fail_enable=True)
        self.assertEqual(code, 1)
        self.assertFalse(report["passed"])
        self.assertTrue(any("-F" in row for row in events))
        self.assertFalse(any("-X" in row for row in events))

    def test_restore_drift_is_not_accepted_as_success(self):
        code, report, _ = self.run_control(drift=True)
        self.assertEqual(code, 1)
        self.assertFalse(report["cleanup"])
        self.assertEqual(report["cleanupCode"], "packet_filter_cleanup_failed")


if __name__ == "__main__":
    unittest.main()
