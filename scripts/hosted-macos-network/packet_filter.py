#!/usr/bin/env python3
"""Packet-filter characterization in a disposable hosted macOS guest."""

import hashlib
import json
import os
import re
import secrets
import signal
import socket
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
            "onlyAppleWildcardAnchor": rules in {'anchor "com.apple/*" all',
                'scrub-anchor "com.apple/*" all fragment reassemble\nanchor "com.apple/*" all'},
            "mainRulesSha256": hashlib.sha256(rules.encode()).hexdigest(),
            "anchorCount": len([line for line in values["anchors"].splitlines() if line.strip()]),
            "loopbackSkip": bool(re.search(r"\bskip\b", detail)),
            "loopbackSeen": True}


def filter_rules(uid, ports):
    if type(uid) is not int or not 500 <= uid <= 1000000 or len(ports) != 2 or len(set(ports)) != 2:
        raise Blocked("filter_selectors_invalid")
    if any(type(port) is not int or not 1024 <= port <= 65535 for port in ports):
        raise Blocked("filter_selectors_invalid")
    return (f"pass out quick on lo0 inet proto tcp from 127.0.0.1 to 127.0.0.1 port {{ {ports[0]}, {ports[1]} }} user {uid} no state\n"
            f"pass out quick on lo0 inet proto tcp from 127.0.0.1 port {{ {ports[0]}, {ports[1]} }} to 127.0.0.1 user {uid} no state\n"
            f"block return out quick proto {{ tcp, udp }} from any to any user {uid}\n")


def pf(args, data=None):
    result = subprocess.run(["/usr/bin/sudo", "-n", "/sbin/pfctl", *args],
                            env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C"},
                            input=data, capture_output=True, timeout=5)
    if len(result.stdout) > 65536 or len(result.stderr) > 8192 or result.returncode != 0:
        raise Blocked("packet_filter_operation_failed")
    return result.stdout, result.stderr


def control():
    # This standalone control never launches an application or admits credentials.
    # It loads only an owned child anchor, never the main ruleset or other anchors.
    require_host(os.environ, sys.platform)
    before = {name: command(name) for name in ["rules", "status", "anchors", "interfaces"]}
    baseline = project(before)
    if baseline["packetFilterEnabled"] or not baseline["onlyAppleWildcardAnchor"] or baseline["loopbackSkip"]:
        raise Blocked("packet_filter_baseline_unadmitted")
    anchor = "com.apple/honowarden-" + secrets.token_hex(12)
    owned = pf(["-a", anchor, "-sr"])[0]
    if owned.strip():
        raise Blocked("packet_filter_anchor_occupied")
    token = None
    installed = False
    receipt = {"schema": "honowarden-macos-network-control-v1", "desktopLaunched": False,
               "allowed": False, "denied": False, "cleanup": False, "passed": False}
    def alarm(*_):
        raise Blocked("packet_filter_deadline")
    previous = signal.signal(signal.SIGALRM, alarm)
    signal.alarm(35)
    try:
        with socket.socket() as allowed, socket.socket() as denied:
            for server in [allowed, denied]:
                server.bind(("127.0.0.1", 0))
                server.listen(3)
            a, d = allowed.getsockname()[1], denied.getsockname()[1]
            with socket.socket() as spare:
                spare.bind(("127.0.0.1", 0))
                second = spare.getsockname()[1]
            rules = filter_rules(os.getuid(), [a, second]).encode()
            # Both owned listeners are reachable before installing the restriction.
            for port in [a, d]:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    pass
            pf(["-n", "-a", anchor, "-f", "-"], rules)
            if command("rules") != before["rules"] or project({**before, "status": command("status")})["packetFilterEnabled"]:
                raise Blocked("packet_filter_baseline_changed")
            installed = True
            pf(["-a", anchor, "-f", "-"], rules)
            out, err = pf(["-E"])
            tokens = re.findall(rb"\bToken\s*:\s*([0-9]{1,20})\b", out + err)
            if len(tokens) != 1:
                raise Blocked("packet_filter_enable_token_unknown")
            token = tokens[0].decode()
            with socket.create_connection(("127.0.0.1", a), timeout=1):
                receipt["allowed"] = True
            try:
                with socket.create_connection(("127.0.0.1", d), timeout=1):
                    pass
            except OSError:
                # A live listener plus a fresh connection is the negative control.
                receipt["denied"] = True
            if not receipt["denied"]:
                raise Blocked("packet_filter_negative_control_failed")
    except Blocked as error:
        receipt["code"] = error.args[0]
    except (OSError, ValueError, subprocess.TimeoutExpired):
        receipt["code"] = "packet_filter_control_failed"
    finally:
        signal.alarm(15)
        try:
            if installed:
                pf(["-a", anchor, "-F", "rules"])
                if pf(["-a", anchor, "-sr"])[0].strip():
                    raise Blocked("packet_filter_cleanup_unproved")
            if token is not None:
                pf(["-X", token])
            after = {name: command(name) for name in ["rules", "status", "anchors", "interfaces"]}
            if after["rules"] != before["rules"] or project(after)["packetFilterEnabled"] != baseline["packetFilterEnabled"]:
                raise Blocked("packet_filter_restore_mismatch")
            receipt["cleanup"] = True
        except (Blocked, OSError, ValueError, subprocess.TimeoutExpired):
            receipt["cleanup"] = False
            receipt["cleanupCode"] = "packet_filter_cleanup_failed"
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
    receipt["passed"] = receipt["allowed"] and receipt["denied"] and receipt["cleanup"] and "code" not in receipt
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt["passed"] else 1


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
    sys.exit(control() if sys.argv[1:] == ["--control"] else main())
