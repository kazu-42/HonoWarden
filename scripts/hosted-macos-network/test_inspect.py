import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
