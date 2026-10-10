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
import secrets
import select
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from types import MappingProxyType

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
FAILURE_KINDS = {"blocked", "attribute_error", "permission_error", "timeout", "subprocess_timeout",
                 "value_error", "os_error", "unknown_exception"}
PROCESS_PERMISSION_CODES = {"process_group_term_permission_denied", "process_group_kill_permission_denied",
                            "process_group_probe_permission_denied", "process_session_probe_permission_denied",
                            "process_wait_permission_denied", "process_poll_permission_denied",
                            "process_identity_command_permission_denied"}
PROCESS_BLOCKED_CODES = {"owned_pid_invalid", "child_registry_invalid", "owned_process_projection_invalid",
                         "owned_process_stop_unproved", "owned_group_without_live_leader",
                         "owned_process_identity_changed", "owned_group_cleanup_unproved",
                         "command_deadline", "command_output_limit", "command_failed", "absolute_step_deadline"} | PROCESS_PERMISSION_CODES
FINALIZATION_BLOCKED_CODES = PROCESS_BLOCKED_CODES | {"phase_deadline_exhausted", "write_deadline_exhausted",
                                                      "cleanup_projection_invalid", "report_unknown_field", "failure_kind_invalid"}
CLEANUP_FAILURE_CODES = FINALIZATION_BLOCKED_CODES | {"process_cleanup_failed", "recorded_process_cleanup_failed",
                                                "process_cleanup_permission_denied", "process_cleanup_timeout",
                                                "process_cleanup_api_unavailable", "keychain_cleanup_failed",
                                                "keychain_readback_failed", "cleanup_finalization_failed",
                                                "cleanup_finalization_permission_denied", "cleanup_finalization_timeout",
                                                 "cleanup_finalization_api_unavailable"}
WORKER_BINARY_PROOF = "pinned_darwin_arm64_version_verified"
WORKERD_BINARY_SHA = "1b652bc9930d82924f9b416a384df910bc667f88cfb72972a0b39532c94a4cfe"
WORKER_FAILURE_PHASES = {"module_setup", "dependency_import", "runtime_binary_probe", "state_prepare", "build", "runtime_construct",
                         "runtime_ready", "runtime_loopback_validate", "d1_migrate",
                         "d1_probe", "r2_probe", "http_probe", "fixture_input",
                         "bundle_restore", "minimal_runtime_construct",
                         "minimal_runtime_ready", "minimal_runtime_loopback_validate",
                         "minimal_http_probe", "minimal_runtime_dispose"}
MINIMAL_WORKER_CONTROLS = {"public_worker_ready_and_reaped"}
DESKTOP_DIAGNOSTIC_KEYS = {"desktopProcessState", "desktopExitCode", "desktopSignal",
                           "desktopReadinessPhase", "desktopReadinessFailurePhase",
                           "desktopReadinessFailureKind"}
DESKTOP_READINESS_PHASES = {"launch_released", "process_poll", "listener_query",
                            "listener_identity", "target_discovery", "target_identity", "ready"}
DESKTOP_READINESS_FAILURES = {"none", "blocked_other", "permission_error", "timeout", "os_error",
                              "value_error", "unknown_exception", "command_failed", "command_deadline",
                              "command_output_limit", "cdp_listener_missing", "cdp_listener_identity_mismatch",
                              "cdp_redirect_refused", "cdp_http_failed", "cdp_http_limit", "cdp_targets_invalid",
                              "desktop_renderer_identity_mismatch", "absolute_step_deadline"}
WORKER_FAILURE_KINDS = {"type_error", "range_error", "syntax_error", "reference_error", "error", "unknown_exception",
                        "miniflare_runtime_module_resolution_marker",
                        "miniflare_runtime_module_evaluation_marker",
                        "miniflare_runtime_failure", "miniflare_runtime_stderr_present", "miniflare_runtime_ports_missing",
                        "miniflare_runtime_inspector_socket_missing", "miniflare_address_in_use", "binary_identity_unproved",
                        "binary_platform_unproved", "binary_digest_mismatch", "binary_file_changed",
                        "binary_probe_spawn_failed", "binary_probe_nonzero_exit", "binary_probe_terminated",
                        "binary_probe_output_invalid", "binary_probe_stderr_present", "binary_probe_output_limit",
                        "binary_probe_deadline", "binary_probe_cleanup_unproved", "binary_probe_stream_failed"}


def effective_client_identity():
    return {"vendor": CLIENT_VENDOR, "slug": CLIENT_SLUG, "bundleDirectory": CLIENT_APP,
            "bundleIdentifier": CLIENT_BUNDLE_ID, "archiveFilename": CLIENT_ARCHIVE,
            "assetUrl": ASSET_URL, "codesignRequirement": CODE_SIGN_REQUIREMENT}


class Blocked(Exception):
    pass


class FinalizationFailure(Blocked):
    def __init__(self, projection):
        super().__init__("cleanup_finalization_failed")
        checked = validate_finalization_projection(projection)
        self._projection = MappingProxyType({**checked, "cleanupFailureCodes": tuple(checked["cleanupFailureCodes"])})

    @property
    def projection(self):
        # Own both the retained nested sequence and every returned sequence.
        value = {**self._projection, "cleanupFailureCodes": list(self._projection["cleanupFailureCodes"])}
        return validate_finalization_projection(value)


def validate_finalization_projection(projection):
    keys = {"schemaVersion", "status", "code", "failureKind", "cleanupFailureCodes", "cleanupComplete",
            "nativeExecuted", "authenticated", "credentialAdmission"}
    diagnostic_keys = {"workerFailurePhase", "workerFailureKind"}
    require(type(projection) is dict and (set(projection) - {"minimalWorkerControl"} - DESKTOP_DIAGNOSTIC_KEYS) in
            (keys, keys | diagnostic_keys, keys | {"workerBinaryProof"}, keys | diagnostic_keys | {"workerBinaryProof"})
            and type(projection["schemaVersion"]) is int and projection["schemaVersion"] == 1
            and projection["status"] == "cleanup_failed" and projection["cleanupComplete"] is False
            and (type(projection["nativeExecuted"]) is bool or projection["nativeExecuted"] is None), "escaped_projection_invalid")
    require(type(projection["code"]) is str and re.fullmatch(r"[a-z][a-z0-9_]{2,79}", projection["code"]) is not None,
            "first_failure_projection_invalid")
    checked = public_report(dict(projection))
    return {**checked, "cleanupFailureCodes": list(checked["cleanupFailureCodes"])}


def require(condition, code):
    if not condition:
        raise Blocked(code)


def failure_kind(error):
    # Classify without retaining exception messages, paths, arguments or output.
    for kind, category in [("blocked", Blocked), ("attribute_error", AttributeError),
                           ("permission_error", PermissionError), ("timeout", TimeoutError),
                           ("subprocess_timeout", subprocess.TimeoutExpired), ("value_error", ValueError),
                           ("os_error", OSError)]:
        if isinstance(error, category):
            return kind
    return "unknown_exception"


def process_cleanup_code(error, fallback):
    require(fallback in {"process_cleanup_failed", "recorded_process_cleanup_failed"}, "cleanup_fallback_invalid")
    if isinstance(error, Blocked) and str(error) in PROCESS_BLOCKED_CODES:
        return str(error)
    return {"attribute_error": "process_cleanup_api_unavailable",
            "permission_error": "process_cleanup_permission_denied",
            "timeout": "process_cleanup_timeout", "subprocess_timeout": "process_cleanup_timeout"}.get(failure_kind(error), fallback)


def process_permission_call(code, call, *args, **kwargs):
    # The call-site supplies a closed operation, never a process identity or exception field.
    require(code in PROCESS_PERMISSION_CODES, "cleanup_permission_operation_invalid")
    try:
        return call(*args, **kwargs)
    except PermissionError:
        raise Blocked(code) from None


def validate_cleanup_codes(values):
    require(type(values) is list and len(values) <= 16 and
            all(type(value) is str and value in CLEANUP_FAILURE_CODES for value in values), "cleanup_projection_invalid")


def apply_cleanup_result(report, failures):
    validate_cleanup_codes(failures)
    # State deletion is proved by the separate always-step. Preserve the first body failure.
    report["cleanupComplete"] = False
    if failures:
        report["status"] = "cleanup_failed"
        report["cleanupFailureCodes"] = list(failures)
        report.setdefault("code", failures[0])


def finalization_projection(report, error):
    # Carry only finite failure metadata when cleanup, its lease or its result write escapes.
    if isinstance(error, Blocked) and str(error) in FINALIZATION_BLOCKED_CODES:
        secondary = str(error)
    else:
        secondary = {"attribute_error": "cleanup_finalization_api_unavailable",
                     "permission_error": "cleanup_finalization_permission_denied",
                     "timeout": "cleanup_finalization_timeout", "subprocess_timeout": "cleanup_finalization_timeout"}.get(
                         failure_kind(error), "cleanup_finalization_failed")
    code = report.get("code", secondary)
    require(type(code) is str and re.fullmatch(r"[a-z][a-z0-9_]{2,79}", code) is not None, "first_failure_projection_invalid")
    kind = report.get("failureKind", "unknown_exception") if "code" in report else failure_kind(error)
    previous = report.get("cleanupFailureCodes", [])
    validate_cleanup_codes(previous)
    projection = {"schemaVersion": 1, "status": "cleanup_failed", "code": code, "failureKind": kind,
                  "cleanupFailureCodes": [*previous, secondary], "cleanupComplete": False,
                   "nativeExecuted": report.get("nativeExecuted"), "authenticated": False, "credentialAdmission": False}
    if "workerFailurePhase" in report or "workerFailureKind" in report:
        projection.update({key: report.get(key) for key in ["workerFailurePhase", "workerFailureKind"]})
    if "workerBinaryProof" in report:
        projection["workerBinaryProof"] = report["workerBinaryProof"]
    if "minimalWorkerControl" in report:
        projection["minimalWorkerControl"] = report["minimalWorkerControl"]
    projection.update({key: report[key] for key in DESKTOP_DIAGNOSTIC_KEYS if key in report})
    if "desktopTargetSummary" in report:
        projection["desktopTargetSummary"] = report["desktopTargetSummary"]
    if "desktopLogSummary" in report:
        projection["desktopLogSummary"] = report["desktopLogSummary"]
    return public_report(projection)


def escaped_error_projection(error):
    if isinstance(error, FinalizationFailure):
        return validate_finalization_projection(error.projection)
    return {"status": "pre_auth_blocked", "code": str(error) if isinstance(error, Blocked) else "preflight_runtime_failure",
            "failureKind": failure_kind(error), "authenticated": False, "credentialAdmission": False}


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


def desktop_environment(root, original):
    result = safe_environment(root, original)
    # Chromium on macOS uses this override before NSTemporaryDirectory;
    # TMPDIR alone does not confine the singleton socket to our allowed root.
    result["MAC_CHROMIUM_TMPDIR"] = str(root / "tmp")
    result[CLIENT_SLUG.upper() + "_APPDATA_DIR"] = str(root / "profile")
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
    raw, code = process_permission_call("process_identity_command_permission_denied", command,
                                      ["/bin/ps", "-p", str(pid), "-o", "uid=", "-o", "pgid=", "-o", "lstart=", "-o", "comm="],
                                      timeout=2, ok=(0, 1))
    if code == 1 and not raw.strip():
        return None
    match = re.fullmatch(rb"\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([^\r\n]+)\s*", raw)
    require(match is not None, "owned_process_projection_invalid")
    try:
        session = process_permission_call("process_session_probe_permission_denied", os.getsid, pid)
    except ProcessLookupError:
        return None
    return {"uid": int(match[1]), "pgid": int(match[2]), "session": session,
            "start": b" ".join(match[3].split()).decode(), "image": match[4].decode().strip()}


def gated_launch(arguments, role, env, state, marker, stdout):
    require(role in {"worker", "desktop", "worker_minimal", "worker_company"},
            "child_registry_invalid")
    worker_input = role in {"worker_minimal", "worker_company"}
    if worker_input:
        require(len(arguments) == 5 and arguments[1] == str(HERE / "worker.mjs")
                and arguments[4] ==
                ("minimal" if role == "worker_minimal" else "company"),
                "child_registry_invalid")
    flags = ["--worker-input"] if worker_input else []
    proc = subprocess.Popen([sys.executable, str(HERE / "launch.py"),
                             *flags, *arguments],
                            env=env, stdin=subprocess.PIPE, stdout=stdout,
                            stderr=subprocess.STDOUT if role == "desktop" and stdout == subprocess.PIPE else subprocess.DEVNULL,
                            start_new_session=True)
    PROCESSES.append(proc)
    try:
        identity = process_identity(proc.pid)
        require(identity is not None and identity["uid"] == os.getuid() and
                identity["pgid"] == proc.pid and identity["session"] == proc.pid, "launch_owner_not_ready")
        # The launcher can exec only these fixed image basenames; no argv or credential is saved.
        images = {Path(sys.executable).name, Path(sys.executable).resolve().name, "Python", "python3"}
        images.add("node" if role in {"worker", "worker_minimal", "worker_company"}
                   else "sandbox-exec")
        if role == "desktop":
            images.add(CLIENT_VENDOR)
        state["children"].append({"pid": proc.pid, "role": role, "uid": identity["uid"],
                                  "pgid": identity["pgid"], "session": identity["session"],
                                  "start": identity["start"], "images": sorted(images)})
        update_private(marker, state)
        proc.stdin.write(b"GO\n")
        proc.stdin.flush()
        if not worker_input:
            proc.stdin.close()
        return proc
    except BaseException:
        proc.stdin.close()
        stop_group(proc)
        raise


def stop_recorded(row):
    require(set(row) == {"pid", "role", "uid", "pgid", "session", "start", "images"}
            and row["role"] in {"worker", "desktop", "worker_minimal", "worker_company"}
            and row["uid"] == os.getuid()
            and row["pid"] == row["pgid"] == row["session"], "child_registry_invalid")
    current = process_identity(row["pid"])
    if current is None:
        try:
            process_permission_call("process_group_probe_permission_denied", os.killpg, row["pgid"], 0)
        except ProcessLookupError:
            return
        raise Blocked("owned_group_without_live_leader")
    require(all(current[k] == row[k] for k in ["uid", "pgid", "session", "start"])
            and Path(current["image"]).name in row["images"], "owned_process_identity_changed")
    process_permission_call("process_group_term_permission_denied", os.killpg, row["pgid"], signal.SIGTERM)
    end = time.monotonic() + time_budget(3)
    while time.monotonic() < end:
        try:
            process_permission_call("process_group_probe_permission_denied", os.killpg, row["pgid"], 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    current = process_identity(row["pid"])
    require(current is not None and all(current[k] == row[k] for k in ["uid", "pgid", "session", "start"])
            and Path(current["image"]).name in row["images"], "owned_process_identity_changed")
    process_permission_call("process_group_kill_permission_denied", os.killpg, row["pgid"], signal.SIGKILL)
    end = time.monotonic() + time_budget(2)
    while time.monotonic() < end:
        try:
            process_permission_call("process_group_probe_permission_denied", os.killpg, row["pgid"], 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    raise Blocked("owned_group_cleanup_unproved")


def reaped_child_group_absent(proc):
    # Fixed Popen/new-session handles reserve the original PID until reap; no concurrent waiter exists here.
    status = process_permission_call("process_poll_permission_denied", proc.poll)
    require(status is None or type(status) is int, "owned_process_projection_invalid")
    if status is None:
        return False
    end = time.monotonic() + time_budget(1)
    for attempt in range(20):
        try:
            os.killpg(proc.pid, 0)
            break
        except ProcessLookupError:
            return True
        except PermissionError:
            # A reaped leader's group may still be disappearing. Denial never
            # proves absence: only a later ESRCH can do so. Never TERM/KILL a
            # reaped or reused identity, and never extend the shared deadline.
            remaining = min(end - time.monotonic(), time_budget(1))
            if attempt == 19 or remaining <= 0:
                raise Blocked("process_group_probe_permission_denied") from None
            time.sleep(min(0.05, remaining))
    # A remaining or reused group lacks the original leader; never signal it destructively.
    raise Blocked("owned_group_without_live_leader")


def stop_group(proc):
    if reaped_child_group_absent(proc):
        return
    try:
        process_permission_call("process_group_term_permission_denied", os.killpg, proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        if time_budget(2) > 0:
            process_permission_call("process_wait_permission_denied", proc.wait, timeout=time_budget(2))
    except subprocess.TimeoutExpired:
        pass
    if reaped_child_group_absent(proc):
        return
    try:
        process_permission_call("process_group_kill_permission_denied", os.killpg, proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if time_budget(2) > 0:
        process_permission_call("process_wait_permission_denied", proc.wait, timeout=time_budget(2))
    require(reaped_child_group_absent(proc), "owned_process_stop_unproved")


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


def desktop_process_projection(returncode):
    # Only POSIX exit/signal ranges are retained, never arbitrary poll values.
    state, code, signum = "invalid", None, None
    if returncode is None:
        state = "running"
    elif type(returncode) is int and 0 <= returncode <= 255:
        state, code = "exited", returncode
    elif type(returncode) is int and -127 <= returncode <= -1:
        state, signum = "signaled", -returncode
    return {"desktopProcessState": state, "desktopExitCode": code, "desktopSignal": signum}


def observe_desktop_process(app_proc):
    try:
        return desktop_process_projection(app_proc.poll())
    except OSError:
        # Diagnostic observation must not replace the first readiness failure.
        return {"desktopProcessState": "unavailable", "desktopExitCode": None, "desktopSignal": None}


def desktop_readiness_failure(error):
    if isinstance(error, Blocked):
        # Do not format arbitrary exception text, including custom __str__ methods.
        value = error.args[0] if len(error.args) == 1 else None
        return value if type(value) is str and value in DESKTOP_READINESS_FAILURES - {"none"} else "blocked_other"
    return failure_kind(error)


def validate_desktop_diagnostics(report):
    require(DESKTOP_DIAGNOSTIC_KEYS <= report.keys(), "desktop_diagnostics_invalid")
    phase, failed_phase, kind = (report[key] for key in
                               ["desktopReadinessPhase", "desktopReadinessFailurePhase", "desktopReadinessFailureKind"])
    require(type(phase) is str and phase in DESKTOP_READINESS_PHASES
            and type(failed_phase) is str and failed_phase in DESKTOP_READINESS_PHASES | {"none"}
            and type(kind) is str and kind in DESKTOP_READINESS_FAILURES
            and ((failed_phase == "none") == (kind == "none")), "desktop_diagnostics_invalid")
    state, code, signum = (report[key] for key in ["desktopProcessState", "desktopExitCode", "desktopSignal"])
    require(type(state) is str and (
        (state in {"running", "invalid", "unavailable"} and code is None and signum is None)
        or (state == "exited" and type(code) is int and 0 <= code <= 255 and signum is None)
        or (state == "signaled" and code is None and type(signum) is int and 1 <= signum <= 127)
    ), "desktop_diagnostics_invalid")


def desktop_target_summary(candidates, app):
    require(type(candidates) is list and len(candidates) <= 10, "cdp_targets_invalid")
    result = dict(total=len(candidates), pages=0, blankPages=0, filePages=0,
                  ownedBundlePages=0, ownedIndexPages=0)
    expected = str(app / "Contents/Resources/app.asar") + "/"
    for target in candidates:
        require(type(target) is dict and type(target.get("type", "")) is str
                and type(target.get("url", "")) is str, "cdp_targets_invalid")
        if target.get("type") != "page":
            continue
        result["pages"] += 1
        raw = target.get("url", "")
        result["blankPages"] += int(raw in {"", "about:blank"})
        parsed = urllib.parse.urlsplit(raw)
        if parsed.scheme == "file":
            result["filePages"] += 1
            path = urllib.parse.unquote(parsed.path)
            if not parsed.netloc and path.startswith(expected) and ".." not in PurePosixPath(path).parts:
                result["ownedBundlePages"] += 1
                result["ownedIndexPages"] += int(path.endswith("/index.html"))
    return result


class DesktopLogProjection:
    """Drain owned pre-auth output in RAM; only fixed markers may be projected."""
    def __init__(self):
        self.seen = 0
        self.tail = b""
        self.summary = dict(outputPresent=False, truncated=False, readFailed=False,
                            singletonMarker=False, permissionMarker=False,
                            socketMarker=False, gpuMarker=False)

    def feed(self, value):
        require(type(value) is bytes, "desktop_log_input_invalid")
        self.summary["outputPresent"] |= bool(value)
        remaining = max(0, CAP - self.seen)
        self.summary["truncated"] |= len(value) > remaining
        self.seen += min(remaining, len(value))
        if not remaining:
            return
        text = (self.tail + value[:remaining]).lower()
        markers = {"singletonMarker": [b"process_singleton", b"singletonlock", b"singletonsocket"],
                   "permissionMarker": [b"permission denied", b"operation not permitted"],
                   "socketMarker": [b"socket", b"address already in use"],
                   "gpuMarker": [b"gpu process exited", b"gpu process launch failed"]}
        for key, patterns in markers.items():
            self.summary[key] |= any(pattern in text for pattern in patterns)
        self.tail = text[-64:]

    def drain(self, stream):
        try:
            while True:
                value = stream.read1(4096)
                if not value:
                    break
                self.feed(value)
        except Exception:
            self.summary["readFailed"] = True
        finally:
            self.tail = b""
            try:
                stream.close()
            except Exception:
                self.summary["readFailed"] = True


def capture_desktop_log(proc):
    projection = DesktopLogProjection()
    reader = threading.Thread(target=projection.drain, args=(proc.stdout,), daemon=True)
    reader.start()
    return projection, reader


def await_desktop_target(app_proc, app, cdp_port, report):
    report.update(desktop_process_projection(None))
    report.update(desktopReadinessPhase="launch_released", desktopReadinessFailurePhase="none",
                  desktopReadinessFailureKind="none")
    target = None
    end = time.monotonic() + 30
    try:
        while time.monotonic() < end:
            report["desktopReadinessPhase"] = "process_poll"
            report.update(observe_desktop_process(app_proc))
            require(report["desktopProcessState"] != "unavailable", "desktop_process_observation_failed")
            require(report["desktopProcessState"] != "invalid", "desktop_process_projection_invalid")
            if report["desktopProcessState"] != "running":
                break
            require(time_budget(1) > 0, "absolute_step_deadline")
            try:
                report["desktopReadinessPhase"] = "listener_query"
                listener = command(["/usr/sbin/lsof", "-nP", f"-iTCP:{cdp_port}", "-sTCP:LISTEN", "-Fpn"], timeout=3)[0]
                report["desktopReadinessPhase"] = "listener_identity"
                listener_owned(listener, app_proc.pid, cdp_port)
                report["desktopReadinessPhase"] = "target_discovery"
                candidates = bounded_http(cdp_port, "/json/list")
                report["desktopTargetSummary"] = desktop_target_summary(candidates, app)
                report["desktopReadinessPhase"] = "target_identity"
                expected = str(app / "Contents/Resources/app.asar") + "/"
                matches = [t for t in candidates if t.get("type") == "page" and
                           urllib.parse.urlsplit(t.get("url", "")).scheme == "file" and
                           not urllib.parse.urlsplit(t["url"]).netloc and
                           ".." not in PurePosixPath(urllib.parse.unquote(urllib.parse.urlsplit(t["url"]).path)).parts and
                           urllib.parse.unquote(urllib.parse.urlsplit(t["url"]).path).startswith(expected) and
                           urllib.parse.unquote(urllib.parse.urlsplit(t["url"]).path).endswith("/index.html")]
                require(len(matches) == 1, "desktop_renderer_identity_mismatch")
                target = matches[0]
                report["desktopReadinessPhase"] = "ready"
                break
            except (Blocked, OSError, ValueError) as error:
                report["desktopReadinessFailurePhase"] = report["desktopReadinessPhase"]
                report["desktopReadinessFailureKind"] = desktop_readiness_failure(error)
                readiness_retry(error)
        require(target is not None, "native_cdp_not_ready")
        return target
    finally:
        # Observe before cleanup can terminate the owned launch process.
        report.update(observe_desktop_process(app_proc))


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


def sandbox_profile(port, cdp_port, root):
    require(type(port) is int and type(cdp_port) is int and 1024 <= port <= 65535 and 1024 <= cdp_port <= 65535
            and port != cdp_port, "sandbox_ports_invalid")
    require(isinstance(root, Path) and root.is_absolute() and len(root.parts) >= 3
            and ".." not in root.parts and not any(ord(c) < 32 or ord(c) == 127 for c in str(root)),
            "sandbox_ipc_root_invalid")
    # macOS sandbox-exec availability/SBPL and actual denial are runtime gates, never assumed.
    profile = (f'(version 1)\n(allow default)\n(deny network-outbound)\n'
            f'(allow network-outbound (remote tcp "localhost:{port}"))\n'
            f'(deny network-inbound)\n(allow network-inbound (local tcp "localhost:{cdp_port}"))\n')
    # Electron's singleton and child IPC use pathname Unix sockets. Keep these
    # within the task's temporary/profile directories; no IP exception is added.
    for directory in [root / "tmp", root / "profile"]:
        path = json.dumps(str(directory))
        profile += f'(allow network-outbound (remote unix-socket (subpath {path})))\n'
        profile += f'(allow network-inbound (local unix-socket (subpath {path})))\n'
    return profile


def prove_unix_socket_controls(root, profile, env):
    paths = [root / "tmp/ipc-control", root / "profile/ipc-control", root / "ipc-denied"]
    with contextlib.ExitStack() as stack:
        for path in paths:
            server = stack.enter_context(socket.socket(socket.AF_UNIX))
            server.bind(str(path))
            server.listen(1)
        # The denied socket is live and owned too, but outside both allowlisted
        # directories. A missing server is never accepted as a denial proof.
        probe = ("import errno,socket,sys\n"
                 "for index,path in enumerate(sys.argv[1:4]):\n"
                 " s=socket.socket(socket.AF_UNIX);s.settimeout(1)\n"
                 " try:s.connect(path)\n"
                 " except OSError as e:\n"
                 "  if index!=2 or e.errno!=errno.EPERM:sys.exit(2)\n"
                 " else:\n"
                 "  if index==2:sys.exit(3)\n"
                 " finally:s.close()\n"
                 "s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[4]);s.listen(1);s.close()\n"
                 "print('owned_unix_allowed_outside_denied')")
        output, _ = command(["/usr/bin/sandbox-exec", "-f", str(profile), sys.executable, "-B", "-c", probe,
                             *map(str, paths), str(root / "tmp/ipc-bind-control")], env=env, timeout=5)
        require(output.strip() == b"owned_unix_allowed_outside_denied", "sandbox_unix_control_failed")


def cleanup(root, state):
    failures = []
    for proc in reversed(PROCESSES.copy()):
        try:
            stop_group(proc)
        except Exception as error:
            failures.append(process_cleanup_code(error, "process_cleanup_failed"))
    for row in reversed(state["children"]):
        try:
            stop_recorded(row)
        except Exception as error:
            failures.append(process_cleanup_code(error, "recorded_process_cleanup_failed"))
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
            "gui", "cleanupComplete", "failureKind", "cleanupFailureCodes",
            "workerFailurePhase", "workerFailureKind", "workerBinaryProof",
            "minimalWorkerControl", "desktopTargetSummary", "desktopLogSummary", "unixSocketControls"} | DESKTOP_DIAGNOSTIC_KEYS
    require(set(report) <= keys, "report_unknown_field")
    if "unixSocketControls" in report:
        require(type(report["unixSocketControls"]) is bool, "unix_socket_projection_invalid")
    if "desktopLogSummary" in report:
        summary = report["desktopLogSummary"]
        require(type(summary) is dict and set(summary) == {"outputPresent", "truncated", "readFailed", "singletonMarker", "permissionMarker", "socketMarker", "gpuMarker"}
                and all(type(value) is bool for value in summary.values()), "desktop_log_projection_invalid")
    if "desktopTargetSummary" in report:
        summary = report["desktopTargetSummary"]
        require(type(summary) is dict and set(summary) == {"total", "pages", "blankPages", "filePages", "ownedBundlePages", "ownedIndexPages"}
                and all(type(value) is int and 0 <= value <= 10 for value in summary.values()), "desktop_target_summary_invalid")
        require(summary["ownedIndexPages"] <= summary["ownedBundlePages"] <= summary["filePages"] <= summary["pages"] <= summary["total"]
                and summary["blankPages"] + summary["filePages"] <= summary["pages"], "desktop_target_summary_invalid")
    if DESKTOP_DIAGNOSTIC_KEYS & report.keys():
        validate_desktop_diagnostics(report)
    if "failureKind" in report:
        require(type(report["failureKind"]) is str and report["failureKind"] in FAILURE_KINDS, "failure_kind_invalid")
    if "cleanupFailureCodes" in report:
        validate_cleanup_codes(report["cleanupFailureCodes"])
    if "workerBinaryProof" in report:
        require(type(report["workerBinaryProof"]) is str and report["workerBinaryProof"] == WORKER_BINARY_PROOF,
                "worker_binary_projection_invalid")
    if "minimalWorkerControl" in report:
        require(type(report["minimalWorkerControl"]) is str
                and report["minimalWorkerControl"] in MINIMAL_WORKER_CONTROLS,
                "minimal_worker_projection_invalid")
    if "workerFailurePhase" in report or "workerFailureKind" in report:
        require(type(report.get("workerFailurePhase")) is str and report["workerFailurePhase"] in WORKER_FAILURE_PHASES
                and type(report.get("workerFailureKind")) is str and report["workerFailureKind"] in WORKER_FAILURE_KINDS,
                "worker_failure_projection_invalid")
    gui = report.get("gui")
    if gui is not None:
        require(set(gui) == {"onConsole", "appWindowCount", "accessibilityGranted", "screenCaptureGranted"}
                and type(gui["appWindowCount"]) is int and 0 <= gui["appWindowCount"] <= 100
                and all(type(gui[k]) is bool for k in gui if k != "appWindowCount"), "gui_projection_invalid")
    require(report.get("authenticated") is False and report.get("credentialAdmission") is False, "credential_claim_refused")
    return report


def apply_execute_outcome(report, outcome):
    require(type(outcome) is str and outcome in {"success", "failure", "cancelled", "skipped", "unknown"}, "execute_outcome_invalid")
    # A stored checkpoint precedes lease restoration; actual process success confirms it.
    if report["status"] == "pre_auth_capability_passed" and outcome != "success":
        report.update({"status": "cleanup_failed", "code": "execute_finalization_unproved",
                       "failureKind": "unknown_exception", "cleanupComplete": False,
                       "cleanupFailureCodes": ["cleanup_finalization_failed"]})


def parse_worker_frame(raw):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "worker_projection_invalid")
            result[key] = value
        return result
    try:
        frame = json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError, Blocked):
        raise Blocked("worker_projection_invalid") from None
    require(type(frame) is dict, "worker_projection_invalid")
    if set(frame) in ({"phase", "kind"}, {"phase", "kind", "binary"}):
        require(type(frame["phase"]) is str and frame["phase"] in WORKER_FAILURE_PHASES
                and type(frame["kind"]) is str and frame["kind"] in WORKER_FAILURE_KINDS, "worker_projection_invalid")
        if "binary" in frame:
            require(type(frame["binary"]) is str and frame["binary"] == WORKER_BINARY_PROOF
                    and frame["phase"] != "runtime_binary_probe", "worker_projection_invalid")
        return frame
    require(set(frame) == {"port", "d1", "r2", "worker", "binary"} and type(frame["port"]) is int
            and 1024 <= frame["port"] <= 65535 and all(frame[key] is True for key in ["d1", "r2", "worker"])
            and type(frame["binary"]) is str and frame["binary"] == WORKER_BINARY_PROOF,
            "worker_projection_invalid")
    return frame


def read_worker_readiness(worker, report):
    line, end = bytearray(), time.monotonic() + 45
    failed = None
    while True:
        require(time.monotonic() < end, "worker_readiness_deadline")
        require(time_budget(0.1) > 0, "absolute_step_deadline")
        # Buffered terminal diagnostics remain readable after the child has exited.
        readable = select.select([worker.stdout], [], [], time_budget(0.1))[0]
        if not readable and worker.poll() is not None:
            require(time.monotonic() < end, "worker_readiness_deadline")
            require(time_budget(0.1) > 0, "absolute_step_deadline")
            # The child may have flushed and exited after the earlier empty snapshot.
            readable = select.select([worker.stdout], [], [], 0)[0]
            require(readable, "worker_exited_without_readiness")
        if readable:
            block = os.read(worker.stdout.fileno(), 1024)
            if not block:
                if failed is not None:
                    report.update(workerFailurePhase=failed["phase"], workerFailureKind=failed["kind"])
                    if "binary" in failed:
                        report["workerBinaryProof"] = failed["binary"]
                    raise Blocked("worker_readiness_failed")
                raise Blocked("worker_readiness_eof")
            require(failed is None, "worker_projection_invalid")
            line.extend(block)
            require(len(line) <= 1024, "worker_projection_limit")
            if b"\n" in line:
                require(line.endswith(b"\n") and line.count(b"\n") == 1, "worker_projection_invalid")
                frame = parse_worker_frame(bytes(line))
                if "phase" in frame:
                    failed = frame
                    continue
                require(worker.poll() is None, "worker_success_child_exited")
                report["workerBinaryProof"] = frame["binary"]
                return frame


def make_fixture_seed():
    return {"databaseId": str(uuid.uuid4()), "r2BucketId": str(uuid.uuid4()),
            "tokenSecret": secrets.token_hex(32)}


def encode_fixture_input(options, bundle_sha256):
    guid = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    require(type(options) is dict and set(options) ==
            {"databaseId", "r2BucketId", "tokenSecret"}, "fixture_input_invalid")
    require(all(type(options[k]) is str and re.fullmatch(guid, options[k])
                for k in ["databaseId", "r2BucketId"]), "fixture_input_invalid")
    require(type(options["tokenSecret"]) is str and
            re.fullmatch(r"[0-9a-f]{64}", options["tokenSecret"]),
            "fixture_input_invalid")
    require(bundle_sha256 is None or (type(bundle_sha256) is str and
            re.fullmatch(r"[0-9a-f]{64}", bundle_sha256)), "fixture_input_invalid")
    raw = json.dumps({"companyBundleSha256": bundle_sha256, "options": options,
                      "schema": "honowarden.native-preauth-fixture.v1"},
                     sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    require(len(raw) <= 512, "fixture_input_limit")
    return raw


def read_worker_control(worker, end, report):
    raw = bytearray()
    while True:
        remaining = min(end - time.monotonic(), time_budget(0.1))
        require(remaining > 0, "worker_readiness_deadline")
        readable = select.select([worker.stdout], [], [], remaining)[0]
        if not readable and worker.poll() is not None:
            # Preserve terminal frames flushed after the earlier empty snapshot.
            require(time.monotonic() < end and time_budget(0.1) > 0,
                    "worker_readiness_deadline")
            readable = select.select([worker.stdout], [], [], 0)[0]
            require(readable, "worker_exited_without_readiness")
        if not readable:
            continue
        block = os.read(worker.stdout.fileno(), 1)
        require(bool(block), "worker_readiness_eof")
        raw.extend(block)
        require(len(raw) <= 1024, "worker_projection_limit")
        if block == b"\n":
            break
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "worker_projection_invalid")
            value[key] = item
        return value
    try:
        frame = json.loads(raw.decode("utf-8", "strict"),
                           object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError, Blocked):
        raise Blocked("worker_projection_invalid") from None
    require(type(frame) is dict, "worker_projection_invalid")
    if set(frame) == {"syntheticInput"}:
        require(frame["syntheticInput"] == "ready", "worker_projection_invalid")
        return frame
    if set(frame) == {"canary", "companyBundleSha256", "binary"}:
        require(frame["canary"] == "public_worker_ready" and
                frame["binary"] == WORKER_BINARY_PROOF and
                type(frame["companyBundleSha256"]) is str and
                re.fullmatch(r"[0-9a-f]{64}", frame["companyBundleSha256"]),
                "worker_projection_invalid")
        report["workerBinaryProof"] = frame["binary"]
        return frame
    checked = parse_worker_frame(bytes(raw))
    if "phase" in checked:
        report.update(workerFailurePhase=checked["phase"],
                      workerFailureKind=checked["kind"])
        if "binary" in checked:
            report["workerBinaryProof"] = checked["binary"]
        raise Blocked("worker_readiness_failed")
    report["workerBinaryProof"] = checked["binary"]
    return checked


def send_fixture_input(worker, options, bundle_sha256, end):
    require(time.monotonic() < end and time_budget(0.1) > 0,
            "worker_readiness_deadline")
    raw = encode_fixture_input(options, bundle_sha256)
    worker.stdin.write(raw)
    worker.stdin.flush()
    worker.stdin.close()
    require(time.monotonic() < end and time_budget(0.1) > 0,
            "worker_readiness_deadline")


def run_worker_differential(node, company, root, env, state, marker, report):
    global STEP_END
    previous = STEP_END
    end = time.monotonic() + 45
    STEP_END = min(previous, end) if previous is not None else end
    active = None
    try:
        options = make_fixture_seed()
        active = gated_launch([node, str(HERE / "worker.mjs"), str(company),
                               str(root), "minimal"], "worker_minimal", env,
                              state, marker, subprocess.PIPE)
        require(read_worker_control(active, end, report) ==
                {"syntheticInput": "ready"}, "worker_input_ack_invalid")
        send_fixture_input(active, options, None, end)
        canary = read_worker_control(active, end, report)
        require(set(canary) == {"canary", "companyBundleSha256", "binary"},
                "minimal_worker_control_invalid")
        remaining = min(end - time.monotonic(), time_budget(45))
        require(remaining > 0, "worker_readiness_deadline")
        require(process_permission_call("process_wait_permission_denied",
                active.wait, timeout=remaining) == 0, "minimal_worker_exit_invalid")
        stop_group(active)
        report["minimalWorkerControl"] = "public_worker_ready_and_reaped"
        active.stdout.close()
        PROCESSES.remove(active)
        # Only the proved-absent role is retired; Finish retains its two-live-role cap.
        retired = [row for row in state["children"] if row["pid"] == active.pid]
        require(len(retired) == 1 and retired[0]["role"] == "worker_minimal",
                "child_registry_invalid")
        state["children"].remove(retired[0])
        update_private(marker, state)
        require(time.monotonic() < end and time_budget(0.1) > 0,
                "worker_readiness_deadline")
        active = gated_launch([node, str(HERE / "worker.mjs"), str(company),
                               str(root), "company"], "worker_company", env,
                              state, marker, subprocess.PIPE)
        require(read_worker_control(active, end, report) ==
                {"syntheticInput": "ready"}, "worker_input_ack_invalid")
        send_fixture_input(active, options, canary["companyBundleSha256"], end)
        ready = read_worker_control(active, end, report)
        require(set(ready) == {"port", "d1", "r2", "worker", "binary"}
                and active.poll() is None, "worker_success_child_exited")
        return ready
    finally:
        # Failed ACKs keep the gated handle for outer owned cleanup; no input or
        # second child is admitted. Successful input delivery has already closed it.
        STEP_END = previous


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
        readiness = run_worker_differential(node, company, root, env, state,
                                           marker, report)
        port = readiness["port"]
        report.update(d1Ready=True, r2Ready=True, workerReady=True)
        cdp_port = free_port()
        profile = root / "network.sb"
        profile.write_text(sandbox_profile(port, cdp_port, root), encoding="utf-8")
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
        prove_unix_socket_controls(root, profile, env)
        report["unixSocketControls"] = True
        app_proc = gated_launch(["/usr/bin/sandbox-exec", "-f", str(profile), str(executable),
                                 f"--remote-debugging-port={cdp_port}", "--remote-debugging-address=127.0.0.1",
                                 f"--user-data-dir={root / 'profile'}", "--lang=en", "--no-proxy-server"],
                                "desktop", desktop_environment(root, env), state, marker, subprocess.PIPE)
        report["nativeExecuted"] = True
        desktop_log, desktop_log_reader = capture_desktop_log(app_proc)
        try:
            target = await_desktop_target(app_proc, app, cdp_port, report)
        finally:
            if app_proc.poll() is not None:
                desktop_log_reader.join(timeout=time_budget(0.1))
            report["desktopLogSummary"] = dict(desktop_log.summary)
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
        report["failureKind"] = failure_kind(error)
    finally:
        try:
            try:
                STEP_END = phase_deadline(absolute_end, 25)
                signal.setitimer(signal.ITIMER_REAL, time_budget(25))
                failures = cleanup(root, state)
                apply_cleanup_result(report, failures)
                write_private(temp / (marker.stem + "-safe.json"), public_report(report))
            except BaseException as error:
                projected = finalization_projection(report, error)
                report.update(projected)
                raise FinalizationFailure(projected) from None
            finally:
                STEP_END = absolute_end
                signal.setitimer(signal.ITIMER_REAL, max(0.001, time_budget(270)))
                signal.signal(signal.SIGTERM, prior_term)
        except BaseException as error:
            if isinstance(error, FinalizationFailure):
                raise
            raise FinalizationFailure(finalization_projection(report, error)) from None
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
    apply_execute_outcome(report, os.environ.get("PREFLIGHT_EXECUTE_OUTCOME", "unknown"))
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
    carried = None
    try:
        with absolute_step_lease(270):
            try:
                return execute(temp, args.company.resolve(strict=True))
            except FinalizationFailure as error:
                carried = error.projection
                raise
    except BaseException as error:
        if carried is not None and not isinstance(error, FinalizationFailure):
            raise FinalizationFailure(finalization_projection(carried, error)) from None
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never log exception text from commands/network/runtime/paths or full stack traces.
        print(json.dumps(escaped_error_projection(error)))
        sys.exit(1)
