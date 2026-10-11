"""Owned HTTPS trust fixture. Trust mutations require a disposable hosted guest."""

import hashlib
import os
from pathlib import Path
import plistlib
import re
import stat
import sys


class Blocked(Exception):
    pass


def require(value, code):
    if not value:
        raise Blocked(code)


def hosted_only():
    require(sys.platform == "darwin" and all(os.environ.get(k) == v for k, v in {
        "GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "macOS", "GITHUB_REPOSITORY": "kazu-42/HonoWarden",
    }.items()), "tls_hosted_guest_required")


def private_write(path, text):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(text)


def generate(root, run):
    """Generate public-test-only material; this function never changes trust."""
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), "tls_root_invalid")
    directory = root / "tls"
    directory.mkdir(mode=0o700)
    private_write(directory / "ca.cnf", """[req]
distinguished_name=dn
x509_extensions=ca
prompt=no
[dn]
CN=HonoWarden disposable native test CA
[ca]
basicConstraints=critical,CA:true,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
""")
    private_write(directory / "leaf.cnf", """[req]
distinguished_name=dn
prompt=no
[dn]
CN=127.0.0.1
[leaf]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:127.0.0.1
authorityKeyIdentifier=keyid,issuer
""")
    openssl = "/usr/bin/openssl"
    run([openssl, "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-config", str(directory / "ca.cnf"), "-keyout", str(directory / "ca.key"),
         "-out", str(directory / "ca.pem")], timeout=10)
    run([openssl, "req", "-new", "-newkey", "rsa:2048", "-nodes",
         "-config", str(directory / "leaf.cnf"), "-keyout", str(directory / "leaf.key"),
         "-out", str(directory / "leaf.csr")], timeout=10)
    run([openssl, "x509", "-req", "-in", str(directory / "leaf.csr"), "-CA", str(directory / "ca.pem"),
         "-CAkey", str(directory / "ca.key"), "-set_serial", "1", "-days", "1", "-sha256",
         "-extfile", str(directory / "leaf.cnf"), "-extensions", "leaf", "-out", str(directory / "leaf.pem")], timeout=10)
    for path in directory.iterdir():
        require(path.is_file() and not path.is_symlink(), "tls_file_invalid")
        path.chmod(0o600)
    run([openssl, "verify", "-CAfile", str(directory / "ca.pem"), str(directory / "leaf.pem")], timeout=3)
    # Supply the issuer as well as the leaf. The isolated client's HOME must
    # not be required to locate the issuer bytes in another user's keychain.
    private_write(directory / "chain.pem", (directory / "leaf.pem").read_text()
                  + (directory / "ca.pem").read_text())
    return digest_certificate(root)


def digest_certificate(root):
    path = Path(root) / "tls/ca.pem"
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0 and 0 < info.st_size <= 8192, "tls_file_invalid")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def trust_digest(root, run, label):
    require(label in {"before", "after"}, "tls_projection_invalid")
    output = Path(root) / "tls" / ("trust-" + label + "-" + os.urandom(8).hex() + ".plist")
    require(not output.exists(), "tls_projection_exists")
    # Reading the administrator trust domain needs no privilege elevation.
    # Export as the runner so its private snapshot does not become root-owned.
    raw, code = run(["/usr/bin/security", "trust-settings-export", "-d", str(output)],
                    timeout=5, ok=(0, 1))
    if code == 1:
        # An absent administrator trust domain is normal in a fresh guest. A
        # different export failure must not be mistaken for an empty baseline.
        require(not output.exists() and b"No Trust Settings were found" in raw, "tls_trust_read_failed")
        value = b"absent-admin-trust-domain"
    else:
        require(output.is_file() and not output.is_symlink() and output.stat().st_size <= 65536,
                "tls_trust_read_failed")
        require(output.stat().st_uid == os.getuid(), "tls_export_not_owned")
        output.chmod(0o600)
        document = plistlib.loads(output.read_bytes())
        # Removing the last owned entry may leave an empty domain instead of
        # deleting it. Normalize only the known empty schema, never foreign data.
        value = (b"absent-admin-trust-domain" if document == {"trustVersion": 1, "trustList": {}}
                 else plistlib.dumps(document, fmt=plistlib.FMT_BINARY, sort_keys=True))
    return hashlib.sha256(value).hexdigest()


def install(root, keychain, run, remember):
    hosted_only()
    require(Path(keychain) == Path(root) / "owned.keychain-db", "tls_keychain_invalid")
    certificate = generate(root, run)
    before = trust_digest(root, run, "before")
    record = {"schema": "honowarden-owned-tls-v1", "certificateSha256": certificate,
              "baselineSha256": before, "attempted": True}
    remember(record)
    # Only this one-day CA and the exact loopback SSL hostname are trusted in
    # the disposable guest. No expiration/hostname error exception is admitted.
    try:
        run(["/usr/bin/sudo", "-n", "/usr/bin/security", "add-trusted-cert", "-d", "-r", "trustRoot",
             "-p", "ssl", "-s", "127.0.0.1", "-k", str(keychain), str(Path(root) / "tls/ca.pem")], timeout=5)
    except Exception:
        raise Blocked("tls_install_command_failed") from None
    return record


def validate_record(record):
    require(type(record) is dict and set(record) == {"schema", "certificateSha256", "baselineSha256", "attempted"}
            and record["schema"] == "honowarden-owned-tls-v1" and record["attempted"] is True
            and all(type(record[key]) is str and re.fullmatch(r"[0-9a-f]{64}", record[key])
                    for key in ["certificateSha256", "baselineSha256"]), "tls_record_invalid")


def restore(root, record, run):
    hosted_only()
    validate_record(record)
    require(digest_certificate(root) == record["certificateSha256"], "tls_certificate_changed")
    # The independent finish step may run after execute already removed trust.
    # Prove the baseline first; removing an absent entry is not a recovery action.
    if trust_digest(root, run, "after") == record["baselineSha256"]:
        return
    try:
        _, code = run(["/usr/bin/sudo", "-n", "/usr/bin/security", "remove-trusted-cert", "-d", str(Path(root) / "tls/ca.pem")],
                      timeout=5, ok=tuple(range(256)))
    except Exception as error:
        # Preserve finite supervisor failures, never subprocess output or paths.
        kind = error.args[0] if len(error.args) == 1 else None
        code = {"command_deadline": "tls_remove_timeout",
                "command_output_limit": "tls_remove_output_limit",
                "process_group_term_permission_denied": "tls_remove_process_permission",
                "process_group_kill_permission_denied": "tls_remove_process_permission",
                "owned_process_stop_unproved": "tls_remove_process_unproved"}.get(
                    kind if type(kind) is str else None, "tls_remove_command_failed")
        raise Blocked(code) from None
    require(code == 0, "tls_remove_nonzero_exit")
    require(trust_digest(root, run, "after") == record["baselineSha256"], "tls_trust_restore_mismatch")
