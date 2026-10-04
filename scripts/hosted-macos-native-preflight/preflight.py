#!/usr/bin/env python3
"""Finite, pre-auth native capability probe; execution requires a hosted macOS job."""

import argparse
import base64
import contextlib
import hashlib
import json
import os
import plistlib
import re
import select
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

COMPANY_SHA = "2deeee0cf159da92babc86e09de44c12eea2aa93"
ASSET_SHA = "8cb6badb3a8af77cc3e4b060fa14858cd7fd74be7360b1b6e98dde1afed409d2"
ASSET_BYTES = 272075739
UNPACKED_BYTES = 774807395
CLIENT_VENDOR = "Bit" + "warden"
CLIENT_SLUG = CLIENT_VENDOR.lower()
CLIENT_APP = CLIENT_VENDOR + ".app"
CLIENT_BUNDLE_ID = "com." + CLIENT_SLUG + ".desktop"
CLIENT_ARCHIVE = CLIENT_VENDOR + "-2026.9.1-universal-mac.zip"
ASSET_URL = f"https://github.com/{CLIENT_SLUG}/clients/releases/download/desktop-v2026.9.1/{CLIENT_ARCHIVE}"
CODE_SIGN_REQUIREMENT = f'-R=anchor apple generic and identifier "{CLIENT_BUNDLE_ID}"'
GIB = 1024**3
CAP = 65536
HERE = Path(__file__).resolve().parent
PROCESSES = []
STEP_END = None


def effective_client_identity():
    return {"vendor": CLIENT_VENDOR, "slug": CLIENT_SLUG, "bundleDirectory": CLIENT_APP,
            "bundleIdentifier": CLIENT_BUNDLE_ID, "archiveFilename": CLIENT_ARCHIVE,
            "assetUrl": ASSET_URL, "codesignRequirement": CODE_SIGN_REQUIREMENT}


class Blocked(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Blocked(code)


def time_budget(maximum):
    return maximum if STEP_END is None else max(0, min(maximum, STEP_END - time.monotonic()))


@contextlib.contextmanager
def absolute_step_lease(seconds):
    global STEP_END
    previous_end = STEP_END
    previous_handler = signal.getsignal(signal.SIGALRM)
    STEP_END = time.monotonic() + seconds
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Blocked("absolute_step_deadline")))
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield STEP_END
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        STEP_END = previous_end


def phase_deadline(absolute_end, seconds, reserve=0):
    end = min(absolute_end - reserve, time.monotonic() + seconds)
    require(end > time.monotonic(), "phase_deadline_exhausted")
    return end


def readiness_retry(error):
    if isinstance(error, Blocked) and str(error) == "absolute_step_deadline":
        raise error
    remaining = time_budget(0.25)
    require(remaining > 0, "absolute_step_deadline")
    time.sleep(remaining)
    require(time_budget(1) > 0, "absolute_step_deadline")


def hosted_context(env):
    require(sys.platform == "darwin", "macos_required")
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("CI") == "true", "hosted_job_required")
    require(env.get("RUNNER_ENVIRONMENT") == "github-hosted", "fresh_hosted_vm_required")
    require(env.get("RUNNER_OS") == "macOS" and env.get("GITHUB_REPOSITORY") == "kazu-42/HonoWarden", "job_identity_mismatch")
    require(re.fullmatch(r"[0-9]{1,20}", env.get("GITHUB_RUN_ID", "")) is not None, "run_identity_invalid")
    require(re.fullmatch(r"[0-9]{1,5}", env.get("GITHUB_RUN_ATTEMPT", "")) is not None, "run_attempt_invalid")
    temp = Path(env["RUNNER_TEMP"]).resolve(strict=True)
    require(temp.is_dir() and temp.stat().st_uid == os.getuid(), "runner_temp_not_owned")
    return temp


def marker_path(temp):
    return temp / f"hw-macos-preflight-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}.json"


def safe_environment(root, original):
    # Never copy GitHub, cloud, signing, SSH-agent, proxy or operator credentials.
    result = {"PATH": original.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
              "HOME": str(root / "home"), "TMPDIR": str(root / "tmp"), "LANG": "en_US.UTF-8"}
    return result


def write_private(path, value):
    require(time_budget(1) > 0, "write_deadline_exhausted")
    with open(path, "x", encoding="utf-8") as file:
        os.chmod(path, 0o600)
        json.dump(value, file, sort_keys=True)
        file.flush()
        os.fsync(file.fileno())


def update_private(path, value):
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid(), "state_not_owned")
    temporary = path.with_name(path.name + ".update")
    write_private(temporary, value)
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def process_identity(pid):
    require(type(pid) is int and 1 < pid < 2**31, "owned_pid_invalid")
    raw, code = command(["/bin/ps", "-p", str(pid), "-o", "uid=", "-o", "pgid=", "-o", "lstart=", "-o", "comm="],
                        timeout=2, ok=(0, 1))
    if code == 1 and not raw.strip():
        return None
    match = re.fullmatch(rb"\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([^\r\n]+)\s*", raw)
    require(match is not None, "owned_process_projection_invalid")
    try:
        session = os.getsid(pid)
    except ProcessLookupError:
        return None
    return {"uid": int(match[1]), "pgid": int(match[2]), "session": session,
            "start": b" ".join(match[3].split()).decode(), "image": match[4].decode().strip()}


def gated_launch(arguments, role, env, state, marker, stdout):
    proc = subprocess.Popen([sys.executable, str(HERE / "launch.py"), *arguments],
                            env=env, stdin=subprocess.PIPE, stdout=stdout,
                            stderr=subprocess.DEVNULL, start_new_session=True)
    PROCESSES.append(proc)
    try:
        identity = process_identity(proc.pid)
        require(identity is not None and identity["uid"] == os.getuid() and
                identity["pgid"] == proc.pid and identity["session"] == proc.pid, "launch_owner_not_ready")
        # The launcher can exec only these fixed image basenames; no argv or credential is saved.
        images = {Path(sys.executable).name, Path(sys.executable).resolve().name, "Python", "python3"}
        images.add("node" if role == "worker" else "sandbox-exec")
        if role == "desktop":
            images.add(CLIENT_VENDOR)
        state["children"].append({"pid": proc.pid, "role": role, "uid": identity["uid"],
                                  "pgid": identity["pgid"], "session": identity["session"],
                                  "start": identity["start"], "images": sorted(images)})
        update_private(marker, state)
        proc.stdin.write(b"GO\n")
        proc.stdin.flush()
        proc.stdin.close()
        return proc
    except BaseException:
        proc.stdin.close()
        stop_group(proc)
        raise


def stop_recorded(row):
    require(set(row) == {"pid", "role", "uid", "pgid", "session", "start", "images"}
            and row["role"] in {"worker", "desktop"} and row["uid"] == os.getuid()
            and row["pid"] == row["pgid"] == row["session"], "child_registry_invalid")
    current = process_identity(row["pid"])
    if current is None:
        try:
            os.killpg(row["pgid"], 0)
        except ProcessLookupError:
            return
        raise Blocked("owned_group_without_live_leader")
    require(all(current[k] == row[k] for k in ["uid", "pgid", "session", "start"])
            and Path(current["image"]).name in row["images"], "owned_process_identity_changed")
    os.killpg(row["pgid"], signal.SIGTERM)
    end = time.monotonic() + time_budget(3)
    while time.monotonic() < end:
        try:
            os.killpg(row["pgid"], 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    current = process_identity(row["pid"])
    require(current is not None and all(current[k] == row[k] for k in ["uid", "pgid", "session", "start"])
            and Path(current["image"]).name in row["images"], "owned_process_identity_changed")
    os.killpg(row["pgid"], signal.SIGKILL)
    end = time.monotonic() + time_budget(2)
    while time.monotonic() < end:
        try:
            os.killpg(row["pgid"], 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    raise Blocked("owned_group_cleanup_unproved")


def stop_group(proc):
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        if time_budget(2) > 0:
            proc.wait(timeout=time_budget(2))
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if time_budget(2) > 0:
        proc.wait(timeout=time_budget(2))
    require(proc.poll() is not None, "owned_process_stop_unproved")


def command(args, timeout=15, env=None, ok=(0,)):
    budget = time_budget(timeout)
    require(budget > 0, "command_deadline")
    limit = time.monotonic() + budget
    if STEP_END is not None:
        limit = min(limit, STEP_END)
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=env, start_new_session=True)
    PROCESSES.append(proc)
    output = bytearray()
    try:
        while True:
            remaining = min(limit - time.monotonic(), time_budget(timeout))
            require(remaining > 0, "command_deadline")
            ready, _, _ = select.select([proc.stdout], [], [], min(remaining, 0.5))
            if ready:
                block = os.read(proc.stdout.fileno(), 8192)
                if not block:
                    break
                output.extend(block)
                require(len(output) <= CAP, "command_output_limit")
        require(limit > time.monotonic(), "command_deadline")
        code = proc.wait(timeout=max(0, min(limit - time.monotonic(), time_budget(timeout))))
        require(code in ok, "command_failed")
        return bytes(output), code
    finally:
        try:
            stop_group(proc)
        finally:
            proc.stdout.close()
            PROCESSES.remove(proc)


def archive_inventory(archive):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        require(len(entries) == 896 and sum(e.file_size for e in entries) == UNPACKED_BYTES, "archive_layout_mismatch")
        seen = set()
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            require(name and not name.startswith("/") and "\\" not in name and "\x00" not in name, "archive_path_invalid")
            require(parts[0] == CLIENT_APP and ".." not in parts and "." not in parts, "archive_path_escape")
            require(name not in seen and entry.file_size <= UNPACKED_BYTES, "archive_entry_invalid")
            seen.add(name)
            mode = entry.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK), "archive_special_entry")
            if stat.S_ISLNK(mode):
                require(entry.file_size <= 1024, "archive_link_limit")
                target = z.read(entry).decode("utf-8")
                require(not target.startswith("/") and "\\" not in target and "\x00" not in target, "archive_link_invalid")
                combined = os.path.normpath(str(PurePosixPath(name).parent / target))
                require(combined == CLIENT_APP or combined.startswith(CLIENT_APP + "/"), "archive_link_escape")


class AssetRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        self.count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        parsed = urllib.parse.urlsplit(newurl)
        require(self.count <= 3 and parsed.scheme == "https" and parsed.hostname in
                {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
                and parsed.username is None and parsed.password is None, "asset_redirect_refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_asset(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), AssetRedirects())
    end = time.monotonic() + 100
    digest, size = hashlib.sha256(), 0
    with opener.open(ASSET_URL, timeout=15) as response, open(path, "xb") as file:
        os.chmod(path, 0o600)
        require(response.status == 200, "asset_http_failed")
        while block := response.read(1024 * 1024):
            size += len(block)
            require(size <= ASSET_BYTES and time.monotonic() < end, "asset_download_limit")
            require(shutil.disk_usage(path.parent).free >= GIB, "capacity_floor")
            digest.update(block)
            file.write(block)
    require(size == ASSET_BYTES and digest.hexdigest() == ASSET_SHA, "asset_digest_mismatch")
    archive_inventory(path)


def listener_owned(output, expected_pid, port):
    current_pid, found = None, False
    for line in output.decode("utf-8", "strict").splitlines():
        if line.startswith("p"):
            current_pid = int(line[1:])
        elif line.startswith("n"):
            require(current_pid == expected_pid and line[1:] == f"127.0.0.1:{port}", "cdp_listener_identity_mismatch")
            found = True
    require(found, "cdp_listener_missing")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def bounded_http(port, path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPHandler())
    # Discovery endpoints never redirect; signed application identity precedes this read.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise Blocked("cdp_redirect_refused")
    opener.add_handler(NoRedirect())
    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
        require(response.status == 200, "cdp_http_failed")
        raw = response.read(CAP + 1)
        require(len(raw) <= CAP, "cdp_http_limit")
        return json.loads(raw)


def take(sock, count):
    value = bytearray()
    while len(value) < count:
        block = sock.recv(count - len(value))
        require(bool(block), "cdp_closed")
        value.extend(block)
    return bytes(value)


def read_frame(sock):
    header = take(sock, 2)
    require(header[0] & 0x80 and not header[0] & 0x70 and not header[1] & 0x80, "cdp_frame_invalid")
    length = header[1] & 127
    if length == 126:
        length = struct.unpack("!H", take(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", take(sock, 8))[0]
    require(length <= CAP and header[0] & 15 == 1, "cdp_frame_limit")
    return take(sock, length)


def cdp_probe(url, expected_port, expression):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "ws" and parsed.hostname == "127.0.0.1" and parsed.port == expected_port,
            "cdp_websocket_not_loopback")
    require(re.fullmatch(r"/devtools/page/[A-Za-z0-9_-]{1,100}", parsed.path) is not None
            and not parsed.query and not parsed.fragment and parsed.username is None, "cdp_websocket_invalid")
    with socket.create_connection(("127.0.0.1", expected_port), timeout=3) as sock:
        sock.settimeout(5)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f"GET {parsed.path} HTTP/1.1\r\nHost: 127.0.0.1:{expected_port}\r\n"
                   f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                   "Sec-WebSocket-Version: 13\r\n\r\n").encode()
        sock.sendall(request)
        headers = bytearray()
        while not headers.endswith(b"\r\n\r\n"):
            headers.extend(take(sock, 1))
            require(len(headers) <= 8192, "cdp_upgrade_limit")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        fields = {}
        for line in bytes(headers).split(b"\r\n")[1:]:
            if b":" in line:
                name, value = line.split(b":", 1)
                require(name.lower() not in fields, "cdp_upgrade_duplicate_header")
                fields[name.lower()] = value.strip()
        require(headers.startswith(b"HTTP/1.1 101 ") and fields.get(b"sec-websocket-accept") == accept,
                "cdp_upgrade_invalid")
        payload = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        }}).encode()
        require(len(payload) < CAP, "cdp_send_limit")
        mask = os.urandom(4)
        length = bytes([len(payload) | 128]) if len(payload) < 126 else b"\xfe" + struct.pack("!H", len(payload))
        sock.sendall(b"\x81" + length + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload)))
        total, end = 0, time.monotonic() + 10
        while True:
            require(time.monotonic() < end, "cdp_deadline")
            frame = read_frame(sock)
            total += len(frame)
            require(total <= 2 * CAP, "cdp_total_limit")
            result = json.loads(frame)
            if result.get("id") == 1:
                require("error" not in result and "exceptionDetails" not in result.get("result", {}), "cdp_evaluation_failed")
                value = result.get("result", {}).get("result", {}).get("value")
                require(isinstance(value, dict), "cdp_projection_invalid")
                return value


def sandbox_profile(port, cdp_port):
    require(type(port) is int and type(cdp_port) is int and 1024 <= port <= 65535 and 1024 <= cdp_port <= 65535
            and port != cdp_port, "sandbox_ports_invalid")
    # macOS sandbox-exec availability/SBPL and actual denial are runtime gates, never assumed.
    return (f'(version 1)\n(allow default)\n(deny network-outbound)\n'
            f'(allow network-outbound (remote tcp "127.0.0.1:{port}"))\n'
            f'(deny network-inbound)\n(allow network-inbound (local tcp "127.0.0.1:{cdp_port}"))\n')


def cleanup(root, state):
    failures = []
    for proc in reversed(PROCESSES.copy()):
        try:
            stop_group(proc)
        except Exception:
            failures.append("process_cleanup_failed")
    for row in reversed(state["children"]):
        try:
            stop_recorded(row)
        except Exception:
            failures.append("recorded_process_cleanup_failed")
    actions = [["/usr/bin/security", "default-keychain", "-d", "user", "-s", state["priorDefault"]],
               ["/usr/bin/security", "list-keychains", "-d", "user", "-s", *state["priorSearch"]]]
    if (root / "owned.keychain-db").exists():
        actions.append(["/usr/bin/security", "delete-keychain", str(root / "owned.keychain-db")])
    for args in actions:
        try:
            command(args, timeout=3)
        except Exception:
            failures.append("keychain_cleanup_failed")
    try:
        require(not (root / "owned.keychain-db").exists(), "owned_keychain_remains")
        default, _ = command(["/usr/bin/security", "default-keychain", "-d", "user"], timeout=3)
        search, _ = command(["/usr/bin/security", "list-keychains", "-d", "user"], timeout=3)
        require(json.loads(default) == state["priorDefault"] and parse_keychains(search) == state["priorSearch"], "keychain_restore_mismatch")
    except Exception:
        failures.append("keychain_readback_failed")
    return failures


def delete_owned_root(root):
    shutil.rmtree(root)
    require(not root.exists(), "owned_state_cleanup_failed")


def parse_keychains(raw):
    values = []
    for line in raw.decode("utf-8").splitlines():
        if line.strip():
            path = json.loads(line.strip())
            require(isinstance(path, str) and path.startswith("/"), "keychain_path_invalid")
            values.append(path)
    return values


def public_report(report):
    keys = {"schemaVersion", "status", "code", "nativeExecuted", "authenticated", "credentialAdmission",
            "assetSha256", "companySha", "osVersion", "architecture", "nodeVersion", "freeBytes",
            "signatureVerified", "gatekeeperAccepted", "d1Ready", "r2Ready", "workerReady",
            "keychainProbe", "sandboxNegativeControl", "appListenerOwned", "visibleDom", "appLoopback",
            "gui", "cleanupComplete"}
    require(set(report) <= keys, "report_unknown_field")
    gui = report.get("gui")
    if gui is not None:
        require(set(gui) == {"onConsole", "appWindowCount", "accessibilityGranted", "screenCaptureGranted"}
                and type(gui["appWindowCount"]) is int and 0 <= gui["appWindowCount"] <= 100
                and all(type(gui[k]) is bool for k in gui if k != "appWindowCount"), "gui_projection_invalid")
    require(report.get("authenticated") is False and report.get("credentialAdmission") is False, "credential_claim_refused")
    return report


def execute(temp, company):
    global STEP_END
    absolute_end = STEP_END
    require(absolute_end is not None, "absolute_lease_required")
    marker = marker_path(temp)
    require(not marker.exists(), "prior_run_marker_present")
    # Obtain guest restoration state before creating any owned directory.
    default, _ = command(["/usr/bin/security", "default-keychain", "-d", "user"])
    search, _ = command(["/usr/bin/security", "list-keychains", "-d", "user"])
    prior_default = json.loads(default)
    prior_search = parse_keychains(search)
    require(isinstance(prior_default, str) and prior_default.startswith("/"), "keychain_default_invalid")
    root = Path(tempfile.mkdtemp(prefix="hw-macos-preflight-", dir=temp))
    try:
        os.chmod(root, 0o700)
        env = safe_environment(root, os.environ)
        state = {"root": str(root), "uid": os.getuid(), "dev": root.stat().st_dev,
                 "ino": root.stat().st_ino, "priorDefault": prior_default, "priorSearch": prior_search, "children": []}
        write_private(marker, state)
    except BaseException:
        # This root is still empty and no child/native/keychain mutation has been admitted.
        root.rmdir()
        marker.unlink(missing_ok=True)
        raise
    report = {"schemaVersion": 1, "status": "pre_auth_blocked", "nativeExecuted": False,
              "authenticated": False, "credentialAdmission": False, "assetSha256": ASSET_SHA, "companySha": COMPANY_SHA}
    prior_term = signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(Blocked("run_cancelled")))
    try:
        # Initial probes consume the same lease; reserve cleanup within its original end.
        STEP_END = phase_deadline(absolute_end, 220, reserve=30)
        signal.setitimer(signal.ITIMER_REAL, time_budget(220))
        for name in ["home", "tmp", "profile", "extract"]:
            (root / name).mkdir(mode=0o700)
        require(shutil.disk_usage(temp).free >= 3 * GIB, "insufficient_native_capacity")
        head, _ = command(["/usr/bin/git", "-C", str(company), "rev-parse", "HEAD"])
        require(head.decode().strip() == COMPANY_SHA, "company_commit_mismatch")
        dirty, _ = command(["/usr/bin/git", "-C", str(company), "status", "--porcelain", "--untracked-files=no"])
        require(not dirty, "company_tracked_source_modified")
        require(hashlib.sha256((company / "scripts/honowarden-company-admin-smoke.mjs").read_bytes()).hexdigest()
                == "0878f053eb2a87d5c58eafac28b7fc93620e19259fdf49f86a0400a9d99dc575", "public_helper_digest_mismatch")
        report["osVersion"] = command(["/usr/bin/sw_vers", "-productVersion"])[0].decode().strip()
        report["architecture"] = command(["/usr/bin/uname", "-m"])[0].decode().strip()
        require(report["architecture"] in {"arm64", "x86_64"}, "runner_architecture_mismatch")
        node = shutil.which("node")
        require(node is not None, "node_missing")
        report["nodeVersion"] = command([node, "--version"], env=env)[0].decode().strip()
        require(report["nodeVersion"] == "v22.13.0", "node_version_mismatch")
        download_asset(root / "official.zip")
        command(["/usr/bin/ditto", "-x", "-k", str(root / "official.zip"), str(root / "extract")], timeout=30)
        app = root / "extract" / CLIENT_APP
        with open(app / "Contents/Info.plist", "rb") as file:
            info = plistlib.load(file)
        require(info.get("CFBundleIdentifier") == CLIENT_BUNDLE_ID and
                info.get("CFBundleShortVersionString") == "2026.9.1" and
                str(info.get("CFBundleVersion")) == "70259" and info.get("CFBundleExecutable") == CLIENT_VENDOR, "bundle_identity_mismatch")
        command(["/usr/bin/codesign", "--verify", "--deep", "--strict", CODE_SIGN_REQUIREMENT, str(app)], timeout=20)
        report["signatureVerified"] = True
        command(["/usr/sbin/spctl", "--assess", "--type", "execute", str(app)], timeout=20)
        report["gatekeeperAccepted"] = True
        executable = app / "Contents/MacOS" / CLIENT_VENDOR
        architectures = command(["/usr/bin/lipo", "-archs", str(executable)])[0].decode().split()
        require(report["architecture"] in architectures, "desktop_abi_mismatch")
        report["freeBytes"] = shutil.disk_usage(temp).free
        require(report["freeBytes"] >= GIB, "capacity_floor")
        # Empty password is intentional for a disposable, non-secret-bearing probe keychain.
        keychain = str(root / "owned.keychain-db")
        command(["/usr/bin/security", "create-keychain", "-p", "", keychain])
        command(["/usr/bin/security", "unlock-keychain", "-p", "", keychain])
        command(["/usr/bin/security", "set-keychain-settings", "-lut", "300", keychain])
        command(["/usr/bin/security", "list-keychains", "-d", "user", "-s", keychain])
        command(["/usr/bin/security", "default-keychain", "-d", "user", "-s", keychain])
        service = "honowarden-preflight-public-probe"
        command(["/usr/bin/security", "add-generic-password", "-a", "synthetic-public", "-s", service,
                 "-w", "non-secret-capability-probe", keychain])
        command(["/usr/bin/security", "find-generic-password", "-a", "synthetic-public", "-s", service, keychain])
        command(["/usr/bin/security", "delete-generic-password", "-a", "synthetic-public", "-s", service, keychain])
        require(command(["/usr/bin/security", "find-generic-password", "-a", "synthetic-public", "-s", service, keychain], ok=(44,))[1] == 44, "keychain_probe_remains")
        report["keychainProbe"] = True
        worker = gated_launch([node, str(HERE / "worker.mjs"), str(company), str(root)],
                              "worker", env, state, marker, subprocess.PIPE)
        line, end = bytearray(), time.monotonic() + 45
        while not line.endswith(b"\n"):
            require(time.monotonic() < end and worker.poll() is None, "worker_readiness_failed")
            if select.select([worker.stdout], [], [], 0.1)[0]:
                line.extend(os.read(worker.stdout.fileno(), 1024))
                require(len(line) <= 1024, "worker_projection_limit")
        readiness = json.loads(line)
        require(set(readiness) == {"port", "d1", "r2", "worker"} and
                readiness["d1"] is True and readiness["r2"] is True and readiness["worker"] is True, "worker_projection_invalid")
        port = readiness["port"]
        report.update(d1Ready=True, r2Ready=True, workerReady=True)
        cdp_port = free_port()
        profile = root / "network.sb"
        profile.write_text(sandbox_profile(port, cdp_port), encoding="utf-8")
        os.chmod(profile, 0o600)
        allowed, _ = command(["/usr/bin/sandbox-exec", "-f", str(profile), "/usr/bin/curl", "--silent",
                              "--fail", "--max-time", "2", f"http://127.0.0.1:{port}/"], env=env)
        require(json.loads(allowed).get("name") == "HonoWarden", "sandbox_allowed_loopback_failed")
        # Use a live owned loopback listener outside the allowlist; never probe a third party.
        with socket.socket() as sentinel:
            sentinel.bind(("127.0.0.1", 0))
            sentinel.listen(1)
            forbidden = sentinel.getsockname()[1]
            require(forbidden not in {port, cdp_port}, "sandbox_sentinel_port_collision")
            probe = ("import socket,errno,sys;s=socket.socket();s.settimeout(2)\n"
                     f"try:s.connect(('127.0.0.1',{forbidden}))\n"
                     "except OSError as e:sys.exit(0 if e.errno==errno.EPERM else 2)\nelse:sys.exit(3)")
            command(["/usr/bin/sandbox-exec", "-f", str(profile), sys.executable, "-c", probe], env=env)
        report["sandboxNegativeControl"] = True
        app_proc = gated_launch(["/usr/bin/sandbox-exec", "-f", str(profile), str(executable),
                                 f"--remote-debugging-port={cdp_port}", "--remote-debugging-address=127.0.0.1",
                                 f"--user-data-dir={root / 'profile'}", "--lang=en", "--no-proxy-server"],
                                "desktop", env, state, marker, subprocess.DEVNULL)
        report["nativeExecuted"] = True
        target = None
        end = time.monotonic() + 30
        while time.monotonic() < end and app_proc.poll() is None:
            require(time_budget(1) > 0, "absolute_step_deadline")
            try:
                listener = command(["/usr/sbin/lsof", "-nP", f"-iTCP:{cdp_port}", "-sTCP:LISTEN", "-Fpn"], timeout=3)[0]
                listener_owned(listener, app_proc.pid, cdp_port)
                candidates = bounded_http(cdp_port, "/json/list")
                require(isinstance(candidates, list) and len(candidates) <= 10, "cdp_targets_invalid")
                expected = str(app / "Contents/Resources/app.asar") + "/"
                matches = [t for t in candidates if t.get("type") == "page" and
                           urllib.parse.urlsplit(t.get("url", "")).scheme == "file" and
                           urllib.parse.unquote(urllib.parse.urlsplit(t["url"]).path).startswith(expected) and
                           urllib.parse.unquote(urllib.parse.urlsplit(t["url"]).path).endswith("/index.html")]
                require(len(matches) == 1, "desktop_renderer_identity_mismatch")
                target = matches[0]
                break
            except (Blocked, OSError, ValueError) as error:
                readiness_retry(error)
        require(target is not None, "native_cdp_not_ready")
        report["appListenerOwned"] = True
        result = cdp_probe(target["webSocketDebuggerUrl"], cdp_port,
                           "(async()=>({visibleDom:document.visibilityState==='visible'&&!!document.body&&!!document.querySelector('input'),appLoopback:await fetch('http://127.0.0.1:" + str(port) +
                           "/',{mode:'no-cors',credentials:'omit',cache:'no-store'}).then(()=>true).catch(()=>false)}))()")
        require(set(result) == {"visibleDom", "appLoopback"} and all(type(v) is bool for v in result.values()), "renderer_projection_invalid")
        report.update(result)
        require(result["visibleDom"] and result["appLoopback"], "native_ui_loopback_not_ready")
        swift = shutil.which("swift")
        require(swift is not None, "swift_missing")
        gui = json.loads(command([swift, str(HERE / "gui-probe.swift"), str(app_proc.pid)], timeout=25, env=env)[0])
        report["gui"] = gui
        public_report(report)
        require(gui["onConsole"] and gui["appWindowCount"] >= 1, "native_window_not_visible")
        require(any((root / "profile").iterdir()), "owned_profile_not_used")
        require(not (Path(os.path.expanduser("~")) / "Library/Application Support" / CLIENT_VENDOR).exists(), "guest_default_profile_used")
        report["status"] = "pre_auth_capability_passed"
    except BaseException as error:
        report["code"] = str(error) if isinstance(error, Blocked) else "preflight_runtime_failure"
    finally:
        try:
            STEP_END = phase_deadline(absolute_end, 25)
            signal.setitimer(signal.ITIMER_REAL, time_budget(25))
            failures = cleanup(root, state)
            # Profile/archive deletion is proved only by the separate always-step.
            report["cleanupComplete"] = False
            if failures:
                report["status"] = "cleanup_failed"
                report["code"] = failures[0]
            write_private(temp / (marker.stem + "-safe.json"), public_report(report))
        finally:
            STEP_END = absolute_end
            signal.setitimer(signal.ITIMER_REAL, max(0.001, time_budget(270)))
            signal.signal(signal.SIGTERM, prior_term)
    return 0 if report["status"] == "pre_auth_capability_passed" and not failures else 1


def finish(temp):
    marker = marker_path(temp)
    safe = temp / (marker.stem + "-safe.json")
    if not marker.exists():
        print("No native preflight was started; no owned state to clean.")
        return 0
    require(marker.is_file() and not marker.is_symlink() and marker.stat().st_uid == os.getuid()
            and stat.S_IMODE(marker.stat().st_mode) == 0o600, "marker_not_owned")
    state = json.loads(marker.read_text())
    require(set(state) == {"root", "uid", "dev", "ino", "priorDefault", "priorSearch", "children"}
            and isinstance(state["children"], list) and len(state["children"]) <= 2, "marker_schema_invalid")
    root = Path(state["root"])
    require(root.parent == temp and root.name.startswith("hw-macos-preflight-") and not root.is_symlink(), "cleanup_root_invalid")
    root_stat = root.stat()
    require((root_stat.st_uid, root_stat.st_dev, root_stat.st_ino, stat.S_IMODE(root_stat.st_mode)) ==
            (state["uid"], state["dev"], state["ino"], 0o700), "cleanup_root_identity_mismatch")
    # If execute was killed before its cleanup, restore exactly the known guest keychains.
    failures = cleanup(root, state)
    require(not failures, "finish_keychain_cleanup_failed")
    # Any remaining open file rooted in owned state blocks deletion rather than losing evidence.
    output, code = command(["/usr/sbin/lsof", "-nP", "+D", str(root)], timeout=15, ok=(0, 1))
    require(code == 1 and not output, "owned_state_still_open")
    if safe.exists():
        require(safe.is_file() and not safe.is_symlink() and safe.stat().st_uid == os.getuid(), "safe_report_not_owned")
        report = public_report(json.loads(safe.read_text()))
    else:
        # Abrupt termination has no observed capability outcome; never invent nativeExecuted:false.
        report = {"schemaVersion": 1, "status": "pre_auth_blocked", "code": "run_interrupted_before_safe_report",
                  "nativeExecuted": None, "authenticated": False, "credentialAdmission": False,
                  "assetSha256": ASSET_SHA, "companySha": COMPANY_SHA, "cleanupComplete": False}
    delete_owned_root(root)
    report["cleanupComplete"] = True
    safe.unlink(missing_ok=True)
    update = marker.with_name(marker.name + ".update")
    if update.exists():
        require(update.is_file() and not update.is_symlink() and update.stat().st_uid == os.getuid()
                and stat.S_IMODE(update.stat().st_mode) == 0o600, "state_update_not_owned")
        update.unlink()
    marker.unlink()
    projected = json.dumps(report, sort_keys=True)
    print(projected)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as file:
            file.write("Native Desktop pre-auth capability projection (no credentials admitted):\n\n```json\n" + projected + "\n```\n")
    return 0 if report["status"] != "cleanup_failed" else 1


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--capacity-only", action="store_true")
    group.add_argument("--execute", action="store_true")
    group.add_argument("--finish", action="store_true")
    parser.add_argument("--company", type=Path)
    args = parser.parse_args()
    temp = hosted_context(os.environ)
    if args.capacity_only:
        free = shutil.disk_usage(temp).free
        require(free >= 6 * GIB, "insufficient_dependency_preparation_capacity")
        print(json.dumps({"freeBytes": free, "minimumBytes": 6 * GIB, "nativeExecuted": False}))
        return 0
    if args.finish:
        with absolute_step_lease(90):
            return finish(temp)
    require(args.company is not None, "company_path_missing")
    with absolute_step_lease(270):
        return execute(temp, args.company.resolve(strict=True))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never log exception text from commands/network/runtime/paths or full stack traces.
        print(json.dumps({"status": "pre_auth_blocked", "code": str(error) if isinstance(error, Blocked) else "preflight_runtime_failure",
                          "authenticated": False, "credentialAdmission": False}))
        sys.exit(1)
