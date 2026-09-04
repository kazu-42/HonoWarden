# Client Compatibility Matrix

Last release metadata check: 2026-08-16T03:35:28Z.

This matrix records the exact client versions currently tracked by HonoWarden.
It is intentionally conservative: rows stay at `fixture_only` until the same
exact client version and mobile build complete a live run with redacted request
and response evidence. The current structured source of truth is
[`compat/client-matrix.json`](../compat/client-matrix.json).

The already-published `v0.1.0-alpha` release gate is intentionally decoupled
from current upstream tracking. Its historical compatibility matrix is rebuilt
from tag commit `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce` and frozen in the immutable
[`v0.1.0-alpha-client-matrix.json`](../compat/releases/v0.1.0-alpha-client-matrix.json)
snapshot. The tag-time CLI evidence bytes are separately sealed under
[`docs/release/snapshots/v0.1.0-alpha/`](release/snapshots/v0.1.0-alpha/), with their
source path, byte count, and SHA-256 recorded in the snapshot. Refreshing the
current matrix or current evidence documents therefore cannot rewrite what was
present at the tag. The snapshot does not claim that its older clients are the
current supported versions.

Fixture coverage is tracked separately in [`compat/fixture-flows.json`](../compat/fixture-flows.json). CI verifies that every `coveredFlows` value in the matrix maps to at least one fixture file. CI also route-replays every JSON fixture under `compat/fixtures` against the Hono app and compares that replay set with the fixture-flow manifest, so fixture assertions exercise real route behavior instead of only static JSON shape.

## 2026-07-19 Credential Change Source And Local Evidence

The `password_verify` and `password_change` fixture flows are pinned to the
official upstream server `v2026.6.1` commit
`a09c7edb03ae6d4fdece784f1250c67be73d5fe0` and web client
`web-v2026.6.1` commit `39f07436ca60e3f25eac47777671754f288a98f1`.
CI route-replays the current-proof policy response and the structured plus
legacy dual password-change payload against the app.

`pnpm account:password-change:lifecycle` additionally runs a synthetic old/new
credential lifecycle through local Wrangler and real local D1 migrations. That
evidence proves server behavior but is not an official client binary or UI run,
so it does not add a flow to any row's `liveEvidence` and does not promote a
verification level.

`POST /api/accounts/kdf` is pinned to the same revisions. Focused tests cover
the complete PBKDF2-SHA256 bounds and the client-safe Argon2id intersection.
The pinned server permits 15 MiB, while pinned clients require at least 16 MiB,
so HonoWarden accepts only `16..1024` MiB. The
`pnpm account:kdf-change:lifecycle` proves a
PBKDF2-to-Argon2id-to-PBKDF2 generation round trip through local Wrangler and
real local D1. It verifies prelogin, password and refresh token responses,
profile, sync, rejection of both prior credential/session generations, direct
revision advancement after both mutations, two audit rows, and unchanged
encrypted vault data. This remains local synthetic server evidence and likewise
does not add official-client `liveEvidence` or promote a verification level.
The writer is default-off in every tracked Wrangler environment; its local
lifecycle enables it explicitly only after the same Worker has proven the
Argon2id reader paths. This source evidence is not deployment activation.
Once a KDF generation commits, notification cleanup runs through `waitUntil` so
its latency cannot delay the successful response. Failure remains logged while
the API stays successful because the pinned client saves its matching local KDF
only after the request resolves successfully.

`GET /api/accounts/keys` and the one-time V1 `POST /api/accounts/keys` are
pinned to the same server and web-client revisions. The `account_keys` fixture
flow route-replays the client's `publicKey` plus `encryptedPrivateKey` request
and the server's legacy plus nested account-key response. The default-off
`pnpm account:keys:lifecycle` runner additionally proves exact replay,
different-value conflict, concurrent exact initialization, required-audit
rollback, unchanged security stamp and sessions, restart persistence, and flag
rollback through local Wrangler and real local D1. This is synthetic server
evidence only: it does not add `liveEvidence`, promote a compatibility row, or
activate the false flag in any tracked environment.

## Credential Closeout Evidence Levels

Credential closeout evidence is reconciled through the canonical
[`credential-evidence.json`](../compat/credential-evidence.json) registry and
[`credential-closeout-packet.json`](../compat/credential-closeout-packet.json)
packet. These credential evidence levels are not the same scale as the matrix
verification levels below: `fixture_only`, `live_smoke`, and `live_regression`
remain client compatibility row states, while `local_api` and
`local_official_client` classify the local credential-operation evidence packet.

The packet preserves the local, staging, and production boundary explicitly.
Every credential operation claim is local; staging and production counts are
zero. `local_official_client` means pinned official-client readback of local
state after an API-driven operation, not an official-client UI operation, remote
account activation, staging activation, or production activation.

| Evidence level          | Claims |
| ----------------------- | -----: |
| `fixture`               |      0 |
| `local_api`             |      4 |
| `local_official_client` |      7 |
| `staging`               |      0 |
| `production`            |      0 |

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

## 2026-07-13 Premium Surface Boundary

A source-map audit of the pinned browser extension `2026.6.1` found no
feature-specific server capability that can hide Emergency Access, vault breach
lookup, or file Sends while broad premium state is enabled. HonoWarden therefore
returns an explicit state-free HTTP `501` with
`error.code = unsupported_feature` and a client-readable top-level `Message`
for `/api/emergency-access`, `/api/emergency-access/*`,
`GET /api/hibp/breach`, `/api/sends`, `/api/sends/*`, and the `send_access`
grant at `POST /identity/connect/token`.

The pinned extension evaluates weak and reused passwords locally and performs
its manual exposed-password check directly against the external Pwned Passwords
range API, so those flows do not add HonoWarden report routes. TOTP remains a
client-side operation, and authenticated cipher-scoped attachment routes are not
part of this unsupported set. ADR 0015 keeps `GET /api/hibp/breach` state-free
and records reports, security tasks, notification center, and vendor
integrations as non-goals unless a later privacy/security ADR replaces the
guard. This source audit and route contract add no live
client evidence and do not change any verification level in the matrix.

## Metadata Refresh Policy

- Refresh cadence: every 14 days and before every release candidate.
- Stale threshold: treat metadata older than 21 days as stale for release
  planning.
- Source kind: official upstream GitHub release metadata.
- Source refs:
  - `client-apps`: browser extension, desktop, and CLI releases.
  - `android-mobile-apps`: Android Password Manager releases.
  - `ios-mobile-apps`: iOS Password Manager releases.
- Refresh rule: select the latest non-draft, non-prerelease release matching
  the row selector in `compat/client-matrix.json`.
- Promotion rule: updating version/build metadata never promotes
  `verificationLevel`. When an exact version or build changes, remove the old
  row-level `liveEvidence` and set the current row to `fixture_only` until new
  redacted request/response evidence exists.
- Drift rule: when a tracked version advances, re-evaluate the relevant live
  evidence issue before release planning and keep known issues explicit.

## Current Matrix

| Surface           | Version  | Build | Release Tag       | Release Published    | Verification | Current evidence boundary                                                                                                                        |
| ----------------- | -------- | ----- | ----------------- | -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| browser_extension | 2026.7.0 |       | browser-v2026.7.0 | 2026-07-23T16:49:59Z | fixture_only | No exact-version official binary live smoke. Browser 2026.6.1 evidence is historical and does not promote this row.                              |
| desktop           | 2026.7.0 |       | desktop-v2026.7.0 | 2026-07-23T15:20:46Z | fixture_only | No exact-version official binary live smoke. Desktop 2026.6.1 evidence is historical and does not promote this row.                              |
| mobile_android    | 2026.7.1 | 21803 | v2026.7.1-bwpm    | 2026-08-07T22:20:51Z | fixture_only | No exact-version/build official binary live smoke. Android 2026.6.1 build 21713 evidence is historical and does not promote this row.            |
| mobile_ios        | 2026.7.1 | 3432  | v2026.7.1-bwpm    | 2026-08-07T22:12:38Z | fixture_only | No physical-device or simulator live smoke is recorded for this exact version/build.                                                             |
| cli               | 2026.7.0 |       | cli-v2026.7.0     | 2026-07-23T21:16:13Z | fixture_only | No exact-version official binary live smoke. CLI 2026.6.0 login, sync, lifecycle, refresh, and TOTP evidence is historical and does not promote. |

There is intentionally no Web Vault row. HonoWarden's alpha compatibility
target is API-only protocol support for tracked clients, not a hosted or
embedded vault UI. Adding a Web Vault row requires a new ADR, browser security
review, CSP/static-asset provenance rules, deployment and rollback boundaries,
and live evidence.

There is not yet a broad Organizations or shared vault verification row.
[ADR 0010](adr/0010-organizations-team-vault-product-line.md)'s organization foundation and
owner-administered organization collection CRUD are merged source capabilities,
but they advance through slice-specific evidence rather than promoting an
entire client row. Membership, ownership transfer, role administration,
organization cipher sharing and assignment, policy enforcement, complete
cross-user isolation evidence, audit, migration/rollback, and official-client
verification remain required before broad compatibility can be claimed.

Policy metadata remains fixture-covered as authenticated empty list responses
for personal vaults. Policy mutation and organization policy enforcement are
not compatibility claims; [ADR 0006](adr/0006-policy-management-scope.md)
requires policy schema, enforcement points, default behavior, audit, rollback,
and compatibility fixture design before support can be claimed.

Organization collection reads and owner-administered organization collection
CRUD are route-tested source capabilities under ADR 0010. They do not establish
an independent matrix row or organization cipher compatibility. Membership
selection beyond the confirmed owner, cipher assignment, audit, and live
official-client evidence remain outside the current claim.

There is intentionally no Send or public file-sharing row. Cipher-scoped
attachments are authenticated owner-scoped vault operations. A stateful Text
Send foundation under ADR 0011 now exists: migration `0018`, an owner-scoped
repository, and an unmounted owner application service. The runtime route and
`send_access` token lane remain inactive, tracked configuration remains
`send-enabled: false`, and there is no live compatibility evidence. The current
explicit `501` boundary is authoritative. A Send row can be added only for the
exact flow and client version proven after abuse, cleanup, activation,
rollback, and live-evidence gates pass.

There is intentionally no Emergency Access row. Delegated recovery requires
[ADR 0004](adr/0004-emergency-access-scope.md)'s original design gates, now
specified by [ADR 0013](adr/0013-emergency-access-product-line.md). That
accepted future contract is not source capability or runtime support. All
Emergency Access routes remain explicit `501` until identity, wait/approval,
cryptographic handoff, audit, kill-switch, rollback, and live-evidence gates
pass.

Attachment sync metadata has fixture coverage through `attachment_metadata`.
HON-124 records historical issue-local official Desktop `2026.6.1` staging
allocation, upload, download, and delete lifecycle evidence with cleanup. It is
not Desktop `2026.7.0` evidence and does not promote the Desktop matrix row or
prove browser, mobile, production, or broad regression behavior.

## Verification Levels

- `fixture_only`: CI verifies protocol fixtures and route behavior using synthetic payloads, but no real client binary has been run for this exact version.
- `live_smoke`: a real client run completed login and sync against a non-secret test vault, with request and response evidence captured.
- `live_regression`: repeated real client runs cover login, sync, create,
  update, delete, refresh, session revoke, and selected auth lifecycle flows.

## Promotion Rules

1. Do not promote a row beyond `fixture_only` without live request and response evidence linked from `compat/client-matrix.json`.
2. Record exact client version, build number where available, local server commit, test date, and known issues.
3. Do not capture real secrets, vault exports, passwords, token values, or personal vault data.
4. Keep unsupported feature behavior explicit; do not mark a client as broadly compatible when a required flow is untested.
5. Promote to `live_smoke` only for a narrow login/sync smoke. Promote to
   `live_regression` only after `docs/release/live-regression-matrix.md` has a
   ready packet and redacted evidence covering login, sync, item lifecycle,
   refresh, session revoke, and selected auth lifecycle flows.
6. When upstream release metadata advances, update the exact row metadata first,
   then decide whether existing live evidence is still valid. If the client
   version changed, stale live evidence must not be reused for promotion.

## Refresh Procedure

1. Query the official upstream GitHub releases for the source refs listed in
   `compat/client-matrix.json`.
2. For each row, select the latest non-draft, non-prerelease release matching
   the row selector.
3. Update `version`, `build` when present, `releaseTag`,
   `releasePublishedAt`, and root `checkedAt`.
4. If the exact version or mobile build advanced, set `verificationLevel` to
   `fixture_only` and remove mismatched row-level `liveEvidence`. Promote only
   after new exact-version request/response evidence is captured and linked.
5. Add a known issue when a version advances without corresponding live
   evidence.
6. For regression promotion, run `pnpm live:regression:packet -- --strict`
   with the recorded flow ids before editing the matrix row.
7. Run `pnpm compat:test`, `pnpm test`, and `pnpm brand:scan` before merging.

## Fixture-Covered Flows

The `direct_read` route fixtures use small folder and cipher lists whose
`continuationToken` remains `null`. Runtime route tests also cover paginated
folder and cipher list behavior with bounded `pageSize`/`limit` values and
opaque continuation tokens.

- `config`
- `prelogin`
- `password_grant`
- `refresh_grant`
- `empty_sync`
- `account_profile`
- `account_profile_update`
- `account_revision`
- `password_verify`
- `password_change`
- `account_keys`
- `direct_read`
- `metadata_read`
- `device_read`
- `device_update`
- `device_keys_update`
- `device_bulk_trust_update`
- `known_device_preflight`
- `sync_with_items`
- `attachment_metadata`
- `folder_crud`
- `cipher_create`
- `cipher_lifecycle`
- `revision_conflict`
- `device_revoke`
- `session_revoke`
- `totp_login`

## Sealed Alpha Evidence And Post-Tag History

### Sealed `v0.1.0-alpha` Tag-Time Evidence

The sealed tag-time evidence consists only of the CLI `2026.6.0`
`live_smoke`, backed by the immutable
[`live-client-evidence.md`](release/snapshots/v0.1.0-alpha/live-client-evidence.md)
archive. Browser extension and Desktop `2026.6.1`, Android `2026.6.0` build
`21686`, and iOS `2026.6.0` build `3325` remain `fixture_only` in the
published-alpha snapshot.

### Post-Tag Historical Evidence

The documents below were added after the alpha tag. They preserve
version-bound historical observations, but are not part of the sealed tag-time
manifest and do not promote any current 2026.7 row.

- Desktop `2026.6.1` password-login, approval, and empty-vault evidence: [`docs/release/login-with-device-live-client-evidence.md`](release/login-with-device-live-client-evidence.md)
- Desktop `2026.6.1` historical transport checkpoint: [`docs/release/desktop-notification-transport-evidence.md`](release/desktop-notification-transport-evidence.md)
- Browser extension `2026.6.1`: [`docs/release/browser-extension-live-client-evidence.md`](release/browser-extension-live-client-evidence.md) and [`docs/release/login-with-device-live-client-evidence.md`](release/login-with-device-live-client-evidence.md)
- Android `2026.6.1` build `21713`: [`docs/release/android-mobile-live-client-evidence.md`](release/android-mobile-live-client-evidence.md)
- CLI TOTP and recent-auth lifecycle `2026.6.0`: [`docs/release/totp-recent-auth-live-evidence.md`](release/totp-recent-auth-live-evidence.md)
