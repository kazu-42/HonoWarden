#!/usr/bin/env python3
"""Read-only packet-filter characterization in a disposable hosted macOS guest."""

import hashlib
import json
import os
import re
import subprocess
import sys


class Blocked(Exception):
    pass


def require_host(env, platform):
    expected = {"GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                "RUNNER_OS": "macOS", "GITHUB_REPOSITORY": "kazu-42/HonoWarden"}
    if platform != "darwin" or any(env.get(key) != value for key, value in expected.items()):
        raise Blocked("fresh_hosted_guest_required")


def command(operation):
    selectors = {"rules": ["-sr"], "status": ["-si"], "anchors": ["-s", "Anchors"],
                 "interfaces": ["-v", "-s", "Interfaces"]}
    if operation not in selectors:
        raise Blocked("read_operation_invalid")
    # No loading, enabling, flushing or modifying operation exists in this probe.
    result = subprocess.run(["/usr/bin/sudo", "-n", "/sbin/pfctl", *selectors[operation]],
                            env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C"},
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
    if len(result.stdout) > 65536 or len(result.stderr) > 8192:
        raise Blocked("read_output_limit")
    if result.returncode != 0:
        raise Blocked("packet_filter_read_unavailable")
    return result.stdout.decode("utf-8", "strict")


def project(values):
    rules = values["rules"].strip()
    status = values["status"]
    state = re.search(r"^Status: (Enabled|Disabled)\b", status, re.MULTILINE)
    if state is None:
        raise Blocked("packet_filter_status_unknown")
    interfaces = values["interfaces"]
    match = re.search(r"^lo0\b[^\n]*\n(?P<detail>(?:[ \t]+[^\n]*\n?)*)", interfaces, re.MULTILINE)
    if match is None:
        raise Blocked("loopback_interface_unknown")
    detail = match.group(0)
    return {"packetFilterEnabled": state.group(1) == "Enabled",
            "onlyAppleWildcardAnchor": rules == 'anchor "com.apple/*" all',
            "mainRulesSha256": hashlib.sha256(rules.encode()).hexdigest(),
            "anchorCount": len([line for line in values["anchors"].splitlines() if line.strip()]),
            "loopbackSkip": bool(re.search(r"\bskip\b", detail)),
            "loopbackSeen": True}


def main():
    report = {"schema": "honowarden-macos-network-inspection-v1", "mutations": 0,
              "desktopLaunched": False, "passed": False}
    try:
        require_host(os.environ, sys.platform)
        report.update(project({name: command(name) for name in ["rules", "status", "anchors", "interfaces"]}))
        report["passed"] = True
    except Blocked as error:
        report["code"] = error.args[0]
    except (OSError, ValueError, subprocess.TimeoutExpired):
        report["code"] = "packet_filter_inspection_failed"
    print(json.dumps(report, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
