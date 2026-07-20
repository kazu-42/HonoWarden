# Official Client Credential Harness

Status: local harness verified for HON-219 on 2026-07-20.

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
size, or digest mismatch fails before extraction or execution.

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
  must resolve inside the harness root, must not be a symlink, and must have
  mode 0700.
- Requests, responses, state, and downloaded assets use mode 0600.
- Stdout and stderr logs use mode 0600. Generated bridge and native CLI files
  use mode 0700.
- Synthetic passwords, plaintext, raw keys, wrapped keys, and CLI output remain
  in ignored files. The command packet emits only statuses, byte counts,
  versions, labels, and SHA-256 digests.
- CLI arguments reject direct password, session, API key, and client-secret
  flags. Required values use `BW_*` environment variables and are never echoed.
- `HOME`, `TMPDIR`, and the official CLI app-data environment variable point
  inside the isolated harness. The wrapper configures the official CLI to an
  origin-only loopback URL and does not allow a passthrough `config` command.
- Each command gets its own process group. A timeout sends `SIGTERM` to that
  group and escalates to `SIGKILL`; stdout and stderr stay captured.
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
- PBKDF2 and Argon2id 64-byte user-key round trips;
- type-2 wrapped user key, encrypted item, and wrapped private key;
- official RSA keypair generation and private-key unwrap;
- zero stdout and stderr bytes from both crypto runs;
- native CLI `--version` exit 0 with captured output and zero stderr bytes;
- timeout process-group cleanup and secret-redaction unit coverage.

The readback is local evidence, not a claim that HonoWarden currently completes
the aggregate credential lifecycle through an official client.
