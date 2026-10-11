# Current CLI 2026.9.0 Local Smoke Evidence

Status: **passed local `live_smoke`**, not broad `live_regression`, deployment,
or staging/production acceptance. Final run:
2026-09-22T09:50:47.802Z through 2026-09-22T09:56:02.367Z.

The user approved the additional API, migration, rotation consistency work,
and exact-client synthetic revalidation. The implementation and rollout rules
are documented in [user-key ID registration](../operations/user-key-id.md).
All tracked writer flags remain default-off; only this run's private local
configuration enabled `HONOWARDEN_USER_KEY_ID_ENABLED=true`.

## Passing Follow-up

Using the same checksum-verified unmodified official binary listed below and a
new isolated profile, all assertions passed:

- password login and exactly one successful user-key ID backfill;
- forced populated sync and equality of five decrypted fields (name, notes,
  username, password, and URI) with synthetic seed values;
- lock, password unlock, forced sync, and the same decrypted readback;
- logout and unauthenticated status;
- a second password login, sync, and decrypted readback without another key-ID
  registration attempt, followed by logout and unauthenticated status.

All 20 recorded HTTP requests returned 200; the backfill endpoint occurred
once. CLI command exit codes and stderr were checked, not only HTTP status.
Private report: `test/.tmp/current-cli-20260922-wwV0oV/report.json`.
The local Worker and TLS proxy were stopped in `finally` cleanup. No secrets,
keys, key IDs, profile bodies, or decrypted data are included in this document.

An intermediate repair run at 09:46:56–09:47:47 passed initial login and
decryption but failed at unlock: the ID was initially projected only inside
master-password unlock metadata. The exact CLI source consumes
`userDecryption.userKeyId` in
`libs/common/src/key-management/models/response/user-decryption.response.ts`.
A failing regression assertion reproduced that missing field; the final
passing run includes both the root sync ID and wrapped-key metadata. The
intermediate private run is retained at `test/.tmp/current-cli-20260922-RgUTnv/`.

This proves the enumerated local flows only. It does not establish current
client write CRUD, TOTP, session revoke, rotation UI, restart recovery, or
other clients. The CLI row is promoted only to `live_smoke`; the four other
current-client rows remain `fixture_only`. The historical pinned 2026.6.0
harness and sealed published-alpha archive are unchanged.

Repository-wide acceptance is separate: the final full-source run passed
2,663/2,667 tests, with four existing time-bound cases failing. Their unchanged
3-file recheck passed 257/257, but the full run is not recorded as green. See
`docs/current-state.md` and `.workflow/integration-2026-09-06/verification.md`.

## Initial Failing Attempt (Preserved)

Recorded run: 2026-09-22T09:21:36.248Z through 2026-09-22T09:23:15.644Z.
Server base commit: `2846198beb18c085771b6d91a6a7ed28ac51d27e`, plus the
uncommitted integration changes documented in
`.workflow/integration-2026-09-06/verification.md`.

## Exact Client And Isolation

- Official client-apps repository ID: `53538899`.
- Release: `cli-v2026.9.0`, source commit
  `7ecf0d710cf39db40aa4db1c611417af2a0f44e0`.
- Official macOS arm64 asset ID: `570320204`, size `41667669` bytes.
- Archive SHA-256:
  `014bc4c093e586197013fac79b9d0f1df1da6004003293c8930406bf1ffde45b`.
- Archive entry set was exactly `bw`; the extracted unmodified binary reported
  `2026.9.0`. Binary SHA-256:
  `b40c0f110cf88c41954c7be67d15139beb7202cfff8f384af5260f654e94db57`.
- Fresh mode-0700 ignored run root, isolated HOME/TMP/profile, private captured
  logs, loopback-only server configuration, and an isolated Wrangler `--local`
  D1 database with the full migration chain. No normal user profile was used.
- A loopback TLS proxy used a run-owned certificate trusted only by the child
  CLI through `NODE_EXTRA_CA_CERTS`; TLS verification was not disabled. The
  proxy stripped request compression negotiation without modifying bodies.
- The existing checksum-pinned CLI 2026.6.0 crypto bridge generated only the
  synthetic seed account and encrypted item. It is not current-client execution
  evidence. The client under test was the separately verified 2026.9.0 binary.
- No real account, vault data, remote database, deployment, or external writer
  was used. The recorded request log contains method/path/status only; no
  request/response bodies, credentials, tokens, email, or key IDs are published.

## Initial Observed Result

| Request                                         | Result     |
| ----------------------------------------------- | ---------- |
| `GET /api/config`                               | 200        |
| `POST /identity/accounts/prelogin/password`     | 200        |
| `POST /identity/connect/token`                  | 200        |
| `GET /api/config`                               | 200        |
| `GET /api/sync`                                 | 200        |
| `GET /api/accounts/revision-date`               | 200, twice |
| `POST /api/accounts/key-management/user-key-id` | **404**    |

The native `login` command exited unsuccessfully. Its private stderr contains
the 404/not-found failure. HTTP 200 authentication and sync responses do not
establish a successful CLI login. Forced sync, decrypted-field assertions,
lock/unlock, and logout were not reached and are **unverified**. The current CLI
matrix row remained `fixture_only`, without `liveEvidence`, at this checkpoint.

The local Worker and TLS proxy were stopped in the runner's `finally` cleanup.
Private diagnostic state is retained under
`test/.tmp/current-cli-20260922-q0I4fd/`; it must not be pasted or committed.
The execution script is retained at
`/tmp/honowarden-current-clients.FGCKjl/cli-smoke.mjs`. Earlier private setup
attempts are also preserved: one resolved an unexported Wrangler package path;
another used `/api/health` instead of the repository's `/health`. They did not
reach client login and are not compatibility failures.

## Initial Root Cause And Subsequently Approved Scope

The repository at the initial checkpoint had the user-account key rotation route, but no
`POST /api/accounts/key-management/user-key-id` route or user-key-ID storage.
Direct source inspection confirmed this; the integration worktree is not
registered in the available GitNexus index.

Official client source at the exact CLI commit includes
`libs/common/src/key-management/encrypted-migrator/migrations/user-key-id-backfill-migration.ts`.
It asks the SDK to backfill the current user's key ID after unlock. It also
documents a 24-hour cooldown for unsupported-server failures; a fresh profile
must therefore be used for a repaired run, not a profile that may suppress the
retry.

Official server source observed at
`8b5fea2e08cd9ace348d451bb448d92fa0afe302` includes:

- `src/Api/KeyManagement/Controllers/AccountsKeyManagementController.cs`:
  authenticated current-user endpoint;
- `src/Api/KeyManagement/Models/Requests/SetUserKeyIdRequestModel.cs`:
  validated hexadecimal ID, not raw user-key material;
- `src/Core/KeyManagement/Commands/SetUserKeyIdCommand.cs`: rejects a user
  whose ID is already set;
- `src/Sql/dbo/KeyManagement/Stored Procedures/User_SetUserKeyId.sql`:
  persists the ID and advances the user's revision date.

The subsequently approved implementation scope was:

1. Add forward-only nullable key-ID storage and precise input validation.
2. Add authenticated owner-only backfill with an atomic single-winner update,
   replay/conflict handling, and appropriate audit behavior.
3. Update relevant profile/sync/credential response contracts and keep ID state
   coherent through user-key rotation; do not infer the ID from ciphertext.
4. Preserve default-off tracked writer policy and test rejection without writes.
5. Cover unauthorized, malformed, replay, concurrent, rollback, and rotation
   cases with focused tests and real local D1, then rerun the exact native client
   with a new synthetic profile. Do not return a success-shaped no-op.

The API and migration were then implemented and tested locally following user
approval. They have not been applied to staging or production.

## Other Client Preconditions

- Browser: current 2026.9.1 official asset metadata and an existing Chrome for
  Testing 152.0.7977.42 executable were located. No current-version browser run
  was completed.
- Desktop: current 2026.9.0 official universal macOS asset metadata was located.
  No current-version desktop run was completed.
- Android: the existing `honowarden_hon54_api36_arm64` AVD and current 2026.9.0
  build 21909 APK metadata were located. `adb devices` reported no connected
  device. No existing AVD was reset, booted, or overwritten.
- iOS: the user connected and authorized the physical iPhone 15 (iOS 26.5,
  wired/paired, Developer Mode enabled). No target app was previously installed.
  Official asset ID `568510575` from repository ID `666493404` was downloaded:
  138668936 bytes, SHA-256
  `09a0bb50c77721595bee6a4603e81608a47d3961ca1746336c08389c5f5d4862`.
  Version readback was 2026.9.0 and `codesign --verify --deep --strict` passed.
  Normal device installation nevertheless failed with `0xe800801f`:
  "Attempted to install a Beta profile without the proper entitlement."
  The official profile carries `beta-reports-active=true`. No re-signing,
  entitlement modification, app deletion, or signature bypass was attempted.
  The user was asked to install through App Store or authorized TestFlight.
  Subsequent user installation resolved this installation blocker: device
  readback confirmed the official iOS client, 2026.9.0 build 3521 (rechecked at
  2026-09-22T10:57Z), normal launch succeeded, and iPhone Mirroring showed the
  pre-login onboarding screen. No HonoWarden login, sync, or decryption has
  occurred. The proposed local HTTPS lane needs device trust approval before
  installing a test CA; no trust store, DNS, or public endpoint was changed.
  Exact-version/build iOS compatibility remains unverified, not a server failure.
  Private install diagnostics remain at
  `/tmp/honowarden-ios-20260922.u471q0/install-result.json`.

No cross-client compatibility result is inferred from the CLI failure. All four
other current rows remain `fixture_only`. Repository-evidence consistency and
exact-client functional acceptance are independent gates.
