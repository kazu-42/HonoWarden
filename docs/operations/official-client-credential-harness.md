# Official Client Credential Harness

Status: HON-219 and HON-220 are merged. HON-225 same-account generation-bound
fresh restore passes locally and is pending exact-head review and repository
publication gates.

## Scope

`pnpm client:official-harness` prepares an isolated, synthetic-only upstream
client harness under `test/.tmp/hon-207-official-client`. It proves two
distinct surfaces:

- `upstream-cli-sdk-wasm`: cryptographic material is produced and checked by
  the pinned official CLI SDK/WASM implementation.
- Native official CLI: public CLI commands run through the unmodified pinned
  macOS arm64 binary with an isolated profile and a loopback-only server origin.

This harness does not change a HonoWarden route, runtime flag, database, remote
resource, or compatibility row. Production execution is not supported. Real
credentials and normal browser profiles are not allowed.

## Evidence Levels

Use these labels without promotion:

| Level                   | Meaning                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `fixture`               | Repository unit tests or synthetic values without a running API/client |
| `local_api`             | Local HonoWarden route and D1/R2 evidence without an official client   |
| `local_official_client` | Pinned official implementation against isolated local state            |
| `staging`               | Approved remote staging evidence                                       |
| `production`            | Separately approved production evidence                                |

HON-219 establishes the crypto bridge and native CLI runner. HON-220 raises the
same local-only evidence level through login, lock, unlock, sync, item read,
credential mutation, restart, rollback, and fresh browser-extension readback.
Neither packet establishes staging or production compatibility.

## Exact Pins

| Surface          | Tag                 | Commit / asset SHA-256                                             |
| ---------------- | ------------------- | ------------------------------------------------------------------ |
| Server source    | `v2026.6.1`         | `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`                         |
| Web source       | `web-v2026.6.1`     | `39f07436ca60e3f25eac47777671754f288a98f1`                         |
| Browser source   | `browser-v2026.6.1` | `723c075bf8b9f45c901e56195be8e94e43ed75a2`                         |
| CLI source       | `cli-v2026.6.0`     | `e6293ff2bc85123e9baaa998cf1543030ec5d9f0`                         |
| CLI npm build    | `cli-v2026.6.0`     | `31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660` |
| CLI macOS arm64  | `cli-v2026.6.0`     | `57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4` |
| Chrome extension | `browser-v2026.6.1` | `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e` |

The script also pins each GitHub release asset ID and byte size. Download,
size, or digest mismatch fails before extraction or execution. It additionally
pins the exact ZIP entry set and a ten-file runtime manifest covering every
extracted CLI JavaScript chunk, source map, locale, WASM module, generated
bridge, module boundary, and native executable. Status and every client
execution recompute those file sizes, modes, and SHA-256 values; `state.json`
is evidence metadata, not an integrity trust root.

## Commands

Plan without touching disk:

```sh
pnpm client:official-harness -- plan
```

Prepare exact assets and an empty isolated profile:

```sh
pnpm client:official-harness -- prepare \
  --execute \
  --confirm official-client-harness
```

Run PBKDF2 and Argon2id official-crypto round trips:

```sh
pnpm client:official-harness -- crypto-roundtrip \
  --execute \
  --confirm official-client-harness
```

Run an unmodified public CLI command against a loopback origin:

```sh
pnpm client:official-harness -- cli-run \
  --origin http://127.0.0.1:8787 \
  --execute \
  --confirm official-client-harness \
  -- --version
```

The passthrough grammar is fail-closed:

- `--version`, `status`, `lock`, and `logout` accept no additional arguments.
- `login` requires one `@example.invalid` address and
  `--passwordenv BW_PASSWORD`; only `--raw` and `--nointeraction` are optional.
- `unlock` requires `--passwordenv BW_PASSWORD`, except for exact `--check`.
- `get` accepts only `get item fixture-<id>` or a canonical item UUID.
- `list` accepts only `list items`.
- `sync` accepts no option, `--force`, or `--last`.

Positional passwords, attachment export, password files, API keys, one-time
codes, sessions, and all other option shapes are rejected before a command
packet is built, so rejected values cannot appear in plan output. Unknown
harness options use a constant error and never reflect the rejected option or
its value. `--origin` is accepted only for `cli-run`; action-inapplicable
origins are rejected before packet rendering.
The generated execution command preserves the packet's canonical `--at` value
and any explicit `--timeout-ms` value, so executing a reviewed packet cannot
silently change its timestamp or timeout bound.

Read status or remove all local material:

```sh
pnpm client:official-harness -- status \
  --execute \
  --confirm official-client-harness

pnpm client:official-harness -- cleanup \
  --execute \
  --confirm official-client-harness
```

Plan the aggregate same-account lifecycle without creating local state:

```sh
pnpm account:credential-lifecycle -- plan
```

Run the CLI-only lifecycle with temporary managed state:

```sh
pnpm account:credential-lifecycle -- run \
  --execute \
  --confirm credential-lifecycle
```

Add a pinned official browser-extension readback and retain ignored D1/R2
evidence for local inspection:

```sh
pnpm account:credential-lifecycle -- run \
  --persist-to test/.tmp/hon220-local-evidence \
  --keep-state \
  --browser-executable "$CHROME_FOR_TESTING" \
  --execute \
  --confirm credential-lifecycle
```

An explicit `--persist-to` path must remain under ignored `test/.tmp`, resolve
inside that root, be new or empty, contain no symlink escape, and use mode 0700. The runner writes a private ownership marker before mutation. Without
`--keep-state`, cleanup validates that marker and removes the directory even
when `--persist-to` was explicit. `--keep-state` is rejected without an
explicit path.

## Isolation And Secret Handling

- The root and every mutable subdirectory must be inside ignored `test/.tmp`,
  must resolve inside the harness root, must not contain a symlink at any
  depth, and must have mode 0700 for directories and 0600 for files.
- Global and named CLI profile directories, each profile's HOME, and each TMP
  directory are independently resolved and mode-checked before any profile
  document is written. Symlinked named profiles cannot redirect writes outside
  the ignored harness.
- Requests, responses, state, and downloaded assets use mode 0600.
- Stdout and stderr logs use mode 0600. Generated bridge and native CLI files
  use mode 0700.
- Synthetic passwords, plaintext, raw keys, wrapped keys, and CLI output remain
  in ignored files. The command packet emits only statuses, byte counts,
  versions, labels, and SHA-256 digests.
- CLI arguments use the command-specific grammar above. Ambient `BW_PASSWORD`
  and `BW_SESSION` are always dropped. Explicit
  `HONOWARDEN_SYNTHETIC_BW_PASSWORD` and
  `HONOWARDEN_SYNTHETIC_BW_SESSION` inputs are mapped to the child-only
  `BW_PASSWORD` and `BW_SESSION` names; the prefixed names and all other
  `BW_*` variables are not forwarded. `BW_NOINTERACTION=true` is always set.
- `HOME`, `TMPDIR`, and the official CLI app-data environment variable point
  inside the isolated harness. A fresh profile starts with a wrapper-owned
  mode-0600 empty JSON document so the pinned CLI does not emit its
  first-access initialization notice; an existing document is never
  overwritten. Before each command, the wrapper reads the official CLI's
  current server. It skips the setter when the requested loopback origin
  already matches, updates only when needed, and fails closed if either config
  command fails, times out, or writes stderr. It then reads the pinned
  profile's effective URL map and requires the exact loopback base plus unset
  API, identity, Web Vault, icons, notifications, events, Key Connector, and
  Send overrides before executing the passthrough command. A passthrough
  `config` command is not allowed.
- Each command gets its own process group. A timeout sends `SIGTERM` to that
  group and escalates to `SIGKILL` after the grace period even when the group
  leader exits first; stdout and stderr stay captured. Parent `SIGINT` and
  `SIGTERM` follow the same bounded cleanup path before the original signal is
  propagated. All four detached local credential lifecycle harnesses use the
  same idempotent signal-cleanup contract for their detached Wrangler groups
  and retain their signal listeners until cleanup settles. Lifecycle helper
  commands use the same bounded, output-limited process-group runner; aggregate
  cleanup attempts every browser, helper, TLS proxy, Worker, and managed-state
  step before reporting combined failures.
- HON-220 uses ten one-use official CLI profiles so a rejected profile is never
  reused as later evidence. Worker restarts retain the exact loopback HTTPS
  origin because the official CLI binds login state to that server.
- Browser evidence uses Chrome for Testing and
  `pnpm client:browser-profile`. Normal Brave, Chrome, and incognito profiles
  remain out of bounds. Browser bootstrap blocks external network through a
  dead loopback proxy, separates replayed CDP Runtime/Log events by wall-clock
  phase, and rejects every unmatched console, loading, response, WebSocket, or
  runtime diagnostic.

Do not paste ignored output into an issue, PR, test snapshot, or tracked
evidence file. Record only the redacted packet fields.

## Failure And Recovery

Preparation removes a partially created root on any download, digest,
extraction, version, or state failure. A failed crypto or CLI run leaves
mode-0600 ignored logs for local diagnosis and uses a new run ID on retry.

`cleanup` removes the isolated root and clears the macOS clipboard. It does not
touch a Worker, D1, R2, browser profile, or real account. Re-running `prepare`
is the rollback for harness corruption.

Credential recovery is forward-only: it never restores an older credential
generation. Migration `0016_user_key_rotation_wrapper_history.sql` retains only
per-user SHA-256 fingerprints over the encryption type and length-framed decoded
EncString parts for current and prior wrapped user/private keys, with one digest
namespace across both roles. Equivalent padding and ignored trailing-bit
encodings share one digest. Password, KDF, and complete user-key mutations append
history in the same D1 batch that replaces a wrapper; account-key initialization
records its current user and new private wrappers in the initialization batch.
The history is not retroactive: a wrapper superseded before `0016` cannot be
reconstructed safely. Rollout must drain credential mutations across the
migration/Worker activation window, and rollback must preserve this table unless
an explicit recovery procedure proves that replay defense can be rebuilt.
Backup/restore generation binding belongs to HON-221 and must use an exact
approved post-generation manifest. HON-225 restores that exact final generation
only into a verified fresh local target; it does not roll an account backward or
repair a partially restored target in place.

Run the complete local restore proof with:

```sh
pnpm account:credential-restore:lifecycle -- run \
  --run-root test/.tmp/hon-225-fresh-restore \
  --harness-root test/.tmp/hon-207-official-client \
  --execute \
  --confirm credential-restore-lifecycle
```

The source lifecycle snapshots one authenticated profile for each superseded
generation while that generation is still current. The restore verifier clones
each snapshot into a one-use profile, keeps the original loopback HTTPS origin,
and requires server-side stale-session rejection before and after Worker
restart. Empty or logged-out profiles are not accepted as stale-generation
evidence. Current-generation proof uses fresh official CLI login, lock, unlock,
sync, and decrypted item read before and after restart.

## Verified Readback

The 2026-07-21 local run verified:

- native CLI version `2026.6.0`;
- npm and native asset byte sizes and SHA-256 values above;
- generated bridge SHA-256
  `1a38398906d268c61ad40b79310d4810125f25d056052404fb0b8dfc23cd6601`;
- ten-file runtime manifest SHA-256
  `2f7ee0a87f78bb69366c6780ea57f8a8940a7f7d268f18854ceff96a3111d71b`;
- PBKDF2 and Argon2id 64-byte user-key round trips;
- type-2 wrapped user key, encrypted item, and wrapped private key;
- official RSA keypair generation and private-key unwrap;
- zero stdout and stderr bytes from both crypto runs;
- native CLI `--version` exit 0 with captured output and zero stderr bytes;
- fresh profile initialization followed by zero stderr from every successful
  lifecycle command and its nested server configuration read/write;
- exact loopback profile base with all custom service endpoints unset across
  the global and every persisted per-user environment;
- timeout process-group cleanup, including a TERM-resistant descendant;
- parent-signal process-group cleanup before signal propagation;
- lifecycle signal-listener retention through cleanup completion;
- pre-plan secret rejection, nested symlink rejection, and runtime-tamper
  coverage;
- seven same-account checkpoints through PBKDF2, Argon2id, PBKDF2 return,
  user-key generation 2, and stable-origin Worker restart;
- ten isolated official CLI profiles and four old password/access/refresh/
  profile rejections both before and after final restart;
- required-audit HTTP 503 rollback, concurrent HTTP 200/401 single-commit
  behavior, and stale-wrapper HTTP 400 before/after restart with unchanged D1
  and R2;
- generation manifest SHA-256
  `a1541502029ce0f810d08cfba3b6bc7e604c3858289029086a6efdf18f08cb21`;
- final cross-role wrapper history of seven unique SHA-256 fingerprints, with
  account-key initialization, password, KDF, and complete user-key writes
  covered atomically;
- fresh Chrome for Testing `149.0.7827.55`, five required HTTP 200 routes, six
  decrypted fields, two blocked bootstrap requests, zero external responses,
  zero unexpected diagnostics, run-owned ephemeral CDP validation, and
  complete browser/profile/clipboard cleanup;
- latest fixture secret scan: 40 values checked against 1,680
  tracked/untracked files with zero matches.

The HON-220 readback above proves the local synthetic source lifecycle. It is
not staging, production, disable-state, or forward-recovery evidence.

The 2026-07-21 HON-225 local run additionally verified:

- generation-bound backup manifest SHA-256
  `1cefeb938c3e5e3f268a96d95fdbfa5b427d32afc2b3fd0eb84feb83c6595277`;
- derived generation binding
  `14054d7a0267de04e37f3db865a06a902857c7aa4d044afbaf9ab36bedc011b7`;
- exact restored D1 export SHA-256
  `fe83270da6ab4d82bfa8f48ef10fce687b7f921246b46338ec8bedcfe3f42421`
  and one exact R2 body;
- four old passwords, access tokens, refresh tokens, and authenticated official
  profiles rejected before and after restored Worker restart;
- current access and refresh accepted, plus official CLI decrypted item read
  before and after restart;
- source completion state unchanged, zero foreign-key violations, run root
  removed, and zero retained secret files inside the run root.

This raises only the local synthetic recovery evidence level. It does not prove
remote, staging, production, real-account, disable-state, or forward-recovery
behavior.
