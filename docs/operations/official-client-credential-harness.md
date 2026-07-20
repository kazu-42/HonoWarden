# Official Client Credential Harness

Status: local harness verification passed for HON-219 on 2026-07-20;
exact-head review is pending.

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

HON-219 establishes `local_official_client` only for the crypto bridge and
native CLI runner. It does not establish login, unlock, sync, item read,
credential mutation, staging, or production compatibility.

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

## Isolation And Secret Handling

- The root and every mutable subdirectory must be inside ignored `test/.tmp`,
  must resolve inside the harness root, must not contain a symlink at any
  depth, and must have mode 0700 for directories and 0600 for files.
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
  inside the isolated harness. Before each command, the wrapper reads the
  official CLI's current server. It skips the setter when the requested
  loopback origin already matches, updates only when needed, and fails closed
  if the official CLI refuses an update. It then reads the pinned profile's
  effective URL map and requires the exact loopback base plus unset API,
  identity, Web Vault, icons, notifications, events, Key Connector, and Send
  overrides before executing the passthrough command. A passthrough `config`
  command is not allowed.
- Each command gets its own process group. A timeout sends `SIGTERM` to that
  group and escalates to `SIGKILL` after the grace period even when the group
  leader exits first; stdout and stderr stay captured. Parent `SIGINT` and
  `SIGTERM` follow the same bounded cleanup path before the original signal is
  propagated. All four detached local credential lifecycle harnesses use the same
  idempotent signal-cleanup contract for their detached Wrangler groups and
  retain their signal listeners until cleanup settles.
- Browser evidence, when needed by a later packet, uses Chrome for Testing and
  `pnpm client:browser-profile`. Normal Brave, Chrome, and incognito profiles
  remain out of bounds.

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
generation. Backup/restore generation binding belongs to HON-221 and must use
an exact approved post-generation manifest.

## Verified Readback

The 2026-07-20 local run verified:

- native CLI version `2026.6.0`;
- npm and native asset byte sizes and SHA-256 values above;
- generated bridge SHA-256
  `bceddb20258bd62c85a9e8912b4b616ab5005dbe9cea55208ac3535d1481ff05`;
- ten-file runtime manifest SHA-256
  `c9cc960b26639049d2a87cd723a85796c9d836dee1c66562fdb2096a207b7099`;
- PBKDF2 and Argon2id 64-byte user-key round trips;
- type-2 wrapped user key, encrypted item, and wrapped private key;
- official RSA keypair generation and private-key unwrap;
- zero stdout and stderr bytes from both crypto runs;
- native CLI `--version` exit 0 with captured output and zero stderr bytes;
- exact loopback profile base with all custom service endpoints unset across
  the global and every persisted per-user environment;
- timeout process-group cleanup, including a TERM-resistant descendant;
- parent-signal process-group cleanup before signal propagation;
- lifecycle signal-listener retention through cleanup completion;
- pre-plan secret rejection, nested symlink rejection, and runtime-tamper
  coverage.

The readback is local evidence, not a claim that HonoWarden currently completes
the aggregate credential lifecycle through an official client.
