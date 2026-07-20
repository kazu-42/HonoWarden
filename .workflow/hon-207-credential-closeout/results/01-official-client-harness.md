# CLIENT-1: Pinned Official-Client Harness

Status: passed

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
- Applied the same process-group ownership invariant to the existing HON-203,
  HON-204, and HON-205 local lifecycle harnesses. Nested pnpm invocations
  cannot mutate dependencies, and Wrangler/workerd descendants are reaped
  before a harness returns.
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

The unmodified native CLI ran `--version` after the wrapper configured
`http://127.0.0.1:8787`:

- server configuration exit: 0
- server configuration stderr: 0 bytes
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

## Focused Verification

```text
vitest test/ops/official-client-harness.test.ts: 14 passed
eslint focused files: passed
prettier focused files: passed
git diff --check: passed
official asset prepare: passed
official crypto PBKDF2: passed
official crypto Argon2id: passed
native CLI loopback --version: passed
harness status readback: valid
legacy lifecycle cleanup: 7 passed, zero residual processes
full suite: 97 files, 1181 passed, 0 failed, 0 skipped
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
