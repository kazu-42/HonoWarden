# CLIENT-1: Pinned Official-Client Harness

Status: verification passed; exact-head review pending

Linear issue: HON-219

## Delivered

- Added `pnpm client:official-harness` with dry-run planning and explicit
  `--execute --confirm official-client-harness` mutation gates.
- Pinned exact server, Web, browser, and CLI source commits.
- Pinned exact CLI npm, CLI macOS arm64, and Chrome-extension GitHub release
  asset IDs, byte sizes, and SHA-256 values.
- Added exact-size/digest validation plus an exact ZIP-entry and ten-file
  runtime manifest before extraction and every execution.
- Added a deterministic bridge generator around the pinned upstream CLI
  SDK/WASM bundle. The generated wrapper uses official key generation,
  password wrapping, symmetric encryption, RSA keypair generation, and
  decapsulation-key unwrapping.
- Added an unmodified native CLI runner with an isolated profile, HOME, TMPDIR,
  loopback-only origin, command-specific synthetic-only argument grammar,
  pre-plan secret rejection, output capture, timeout, and process-group
  cleanup.
- Added read-before-write CLI server configuration. A matching origin skips the
  setter so login, unlock, sync, get, lock, status, and logout can share one
  logged-in profile. The pinned profile's global and every persisted per-user
  environment must remain Self-hosted, retain the exact loopback base, and
  leave every service override unset before passthrough execution.
- Dropped ambient `BW_PASSWORD` and `BW_SESSION`; only explicit
  `HONOWARDEN_SYNTHETIC_BW_*` inputs are mapped to child-only `BW_*` names.
- Applied the same process-group ownership invariant to the existing HON-203
  through HON-206 local lifecycle harnesses. Nested pnpm invocations cannot
  mutate dependencies, and Wrangler/workerd descendants are reaped before a
  harness returns or propagates `SIGINT`/`SIGTERM`. POSIX hosts use bounded
  process-group signaling; Windows uses `taskkill /T /F` plus a positive-PID
  exit check.
- Added recursive mode, realpath, exact-file-set, and symlink enforcement for
  the ignored root, all runtime files, and all mutable trees.
- Added the operator runbook at
  `docs/operations/official-client-credential-harness.md`.

No product route, runtime flag, migration, D1/R2 state, remote resource,
compatibility row, real account, or normal browser profile changed.

## Provenance Readback

| Item                  | Readback                                                                             |
| --------------------- | ------------------------------------------------------------------------------------ |
| Server source         | `v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0`                                 |
| Web source            | `web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1`                             |
| Browser source        | `browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2`                         |
| CLI source            | `cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0`                             |
| CLI npm asset         | ID `457887277`, 4,402,383 bytes, SHA-256 `31765936...c0660`                          |
| CLI macOS arm64 asset | ID `457887093`, 41,121,808 bytes, SHA-256 `57d1e60d...64d4`                          |
| Chrome asset metadata | ID `462351736`, 21,593,500 bytes, SHA-256 `fcd29c59...097e`                          |
| Generated bridge      | SHA-256 `bceddb20258bd62c85a9e8912b4b616ab5005dbe9cea55208ac3535d1481ff05`           |
| Runtime manifest      | 10 files, SHA-256 `c9cc960b26639049d2a87cd723a85796c9d836dee1c66562fdb2096a207b7099` |
| Native CLI            | `2026.6.0`                                                                           |

The three release asset records and all four tag-to-commit mappings were read
from official GitHub repositories. The npm and native assets were downloaded
and verified locally. The Chrome asset digest is the existing pinned browser
profile contract and was not downloaded again in this packet.

## Official Crypto Readback

| Case     | KDF readback | User key | EncString types        | stdout/stderr |
| -------- | ------------ | -------- | ---------------------- | ------------- |
| PBKDF2   | `pbkdf2`     | 64 bytes | user/item/private: `2` | 0 / 0 bytes   |
| Argon2id | `argon2id`   | 64 bytes | user/item/private: `2` | 0 / 0 bytes   |

Both cases verified:

- user-key wrap/decrypt equality through the exact password and KDF;
- item encrypt/decrypt equality;
- official RSA keypair generation;
- wrapped private-key decapsulation and non-empty key bytes;
- response provenance matched the exact CLI source and npm asset;
- only redacted metadata and digests reached command stdout.

The final redacted response digests were:

- PBKDF2:
  `dcb5a779e2ce4ec73457a77fef69ba232a25031a1133bba5774bfa7e4ab0f8f8`
- Argon2id:
  `ff72f5178aa0ba0c32a39054e755c0ab145735e70be0eb4eff6434b6de84d0f6`

## Native CLI Readback

The unmodified native CLI ran `--version` after the wrapper read and confirmed
the existing `http://127.0.0.1:8787` configuration:

- server configuration read exit: 0
- server configuration read stdout: 21 bytes, SHA-256
  `b1a61bf29a38ff3642af0dad0785e1677a58232f2e9bb85db3f7a80d8bf1a387`
- server configuration read stderr: 0 bytes
- server configuration write: skipped because the exact origin matched
- effective profile base: exact match
- custom API, identity, Web Vault, icons, notifications, events, Key
  Connector, SCIM, and Send endpoints: all unset
- command exit: 0
- command stdout: 9 bytes, SHA-256
  `83b9a79200e7f9fbfb630cd027974ee46c5ffa79b5ba1190f09d08f125ee716b`
- command stderr: 0 bytes
- residual harness CLI/bridge processes: 0

The profile remained under the ignored harness root. No normal Brave, Chrome,
Chrome for Testing, or incognito profile was attached.

## Red/Green Notes

1. All seven initial tests failed because the harness did not exist.
2. The first implementation passed six tests; the timeout fixture was made
   deterministic before process cleanup was accepted.
3. The first official bridge run exposed ESM inheritance for `685.js`; an exact
   CommonJS boundary was added inside the isolated crypto directory.
4. The second official bridge run reproduced `InvalidUtf8String`; the official
   wrapped decapsulation key was incorrectly treated as a string. The bridge
   now uses official `unwrap_decapsulation_key`.
5. KDF labels and exact PBKDF2/Argon2id parameters were added to response
   validation so the two cases cannot be confused.
6. Mutable-directory symlink replacement, external origin, credential-bearing
   URL, direct secret flags, digest/size tampering, secret output capture, and
   process-group timeout all have fail-closed tests.
7. The first exact-commit review found five gaps: runtime replacement,
   secret-bearing plan output, permissive command arguments, a descendant
   surviving leader exit, and nested profile symlinks. Five red tests
   reproduced those failures before implementation.
8. Remediation binds every runtime file to the code-owned manifest before each
   execution, validates CLI arguments before packet construction, recursively
   validates mutable trees, and keeps escalation alive until the entire process
   group exits.
9. The second exact-commit review found three defects: unconditional server
   writes blocked post-login commands, parent termination could orphan detached
   groups, and replay commands dropped explicit timestamp/timeout values.
10. Six failing checks reproduced those defects plus ambient credential
    forwarding and canonical item-UUID rejection. Remediation added
    read-before-write configuration, idempotent signal cleanup, deterministic
    replay options, explicit synthetic credential mapping, and UUID support.
11. The third exact-commit review found three boundary defects: custom service
    endpoints could bypass the base-origin check, non-CLI `--origin` values
    could reach packet output, and lifecycle signal listeners were removed
    before cleanup settled.
12. Three red tests reproduced the defects. Remediation validates the pinned
    profile's complete effective URL map, rejects action-inapplicable origins
    before packet construction, and keeps signal listeners installed through
    idempotent cleanup completion.
13. The fourth exact-commit review found three defects: a persisted per-user
    environment could override the validated global loopback endpoint, an
    unknown harness option could echo its complete value to stderr, and a
    block relation crossing the managed Linear issue boundary was omitted from
    exactness verification.
14. Three red reproductions now require every persisted environment to remain
    Self-hosted and loopback-only, use a constant unknown-option error, and
    audit active block relations when either endpoint is managed.
15. Live Linear verification then exposed a monotonicity defect: re-running
    sync verification downgraded the workflow status after harness
    verification. A red state-transition test now permits the initial
    `plan_authored` advance while preserving all later and future statuses.
16. An interrupted reviewer run left a temporary brand-scan probe that caused
    one initial full-suite release-bundle failure. The focused file passed
    4/4, temporary fixtures were cleared, and the final serial full-suite run
    passed 1,188/1,188.
17. The fifth exact-commit review found two defects: the focused test cleanup
    assumed the ignored `test/.tmp` directory existed in a clean checkout, and
    detached lifecycle cleanup used POSIX negative process-group IDs on
    Windows.
18. A clean tracked-file copy reproduced the first defect with 9/21 failures.
    Two additional red checks reproduced the missing Windows tree-kill helper
    and direct lifecycle integration. Cleanup now treats a missing fixture
    directory as empty, while a shared helper retains bounded POSIX signaling
    and uses checked `taskkill /T /F` termination on Windows. The clean-copy
    rerun passed 23/23.

## Focused Verification

```text
vitest test/ops/official-client-harness.test.ts: 23 passed
clean tracked-file copy focused rerun: 23 passed
HON-207 Linear plan/relation/state Node tests: 7 passed
live Linear relation readback: 4/4 exact, 0 unexpected
eslint focused files: passed
prettier focused files: passed
git diff --check: passed
official asset prepare: passed
official crypto PBKDF2: passed
official crypto Argon2id: passed
native CLI loopback --version: passed
harness status readback: valid
legacy lifecycle cleanup: 4 real scripts passed, zero residual processes
full suite (maxWorkers=1): 97 files, 1190 passed, 0 failed, 0 skipped
release evidence bundle focused rerun: 4 passed
release gate: ready, 11 passed, 0 manual, 0 blocked
TypeScript: passed
ESLint: passed
Prettier: passed
brand scan: passed
```

## Remaining Boundary

HON-219 proves the harness, not the aggregate account lifecycle. Official CLI
login, unlock, sync, item decrypt, credential mutations, restart rejection,
and real local Worker/D1/R2 evidence remain in HON-220. Backup generation
binding and forward recovery remain in HON-221. Compatibility promotion,
staging, and production remain unproven.
