# Client Compatibility Matrix

Last release metadata check: 2026-07-10T02:50:34Z.

This matrix records the exact client versions currently tracked by HonoWarden. It is intentionally conservative: rows stay at `fixture_only` until a live client run is captured with request and response evidence. The structured source of truth is [`compat/client-matrix.json`](../compat/client-matrix.json).

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
part of this unsupported set. This source audit and route contract add no live
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
  `verificationLevel`; live request/response evidence is still required.
- Drift rule: when a tracked version advances, re-evaluate the relevant live
  evidence issue before release planning and keep known issues explicit.

## Current Matrix

| Surface           | Version  | Build | Release Tag       | Release Published    | Verification | Known Issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------- | ----- | ----------------- | -------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser_extension | 2026.6.1 |       | browser-v2026.6.1 | 2026-06-30T17:07:46Z | live_smoke   | Live browser-extension smoke covers self-hosted environment selection, password login, initial sync, account profile reads, empty-vault render, and staging login-with-device consumption against synthetic accounts only; the original run used Brave's Chromium extension host, while the login-with-device run used isolated Chrome for Testing with unsafe extension debugging enabled only for the pinned unpacked test extension; TOTP login has official CLI plus HTTP auth lifecycle evidence only, with no browser-extension TOTP evidence recorded yet; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                                                      |
| desktop           | 2026.6.1 |       | desktop-v2026.6.1 | 2026-06-30T16:09:04Z | live_smoke   | On 2026-07-13, official Desktop 2026.6.1 exposed a server routing defect: permanent delete via `DELETE /api/ciphers/:id` returned an opaque 404 for a trashed cipher; this change corrects that route and adds the upstream `POST /api/ciphers/:id/delete` alias. A post-fix official-client lifecycle rerun is not recorded yet. Live Desktop smoke covers self-hosted staging selection, password login, initial sync, pending request notification, login-with-device approval, and empty-vault rendering with a synthetic account; the run used the official `ACCESS_TOKEN_LOCATION=DISK` switch and an isolated Electron profile without patching the app or modifying a normal official-client Keychain entry; item lifecycle, TOTP, and full live regression remain unverified; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only. |
| mobile_android    | 2026.6.1 | 21713 | v2026.6.1-bwpm    | 2026-07-09T16:57:30Z | live_smoke   | Live Android smoke covers official F-Droid APK self-hosted environment selection, password login, first empty-vault sync persistence, billing subscription read, and config refresh against a local synthetic account only; the smoke exposed official Retrofit rejection of SQLite `CURRENT_TIMESTAMP` values, so HonoWarden now normalizes outward API timestamps to UTC ISO-8601 before the passing clean run; TOTP login has official CLI plus HTTP auth lifecycle evidence only, with no Android TOTP evidence recorded yet; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                                                                                      |
| mobile_ios        | 2026.6.1 | 3376  | v2026.6.1-bwpm    | 2026-07-09T22:32:52Z | fixture_only | No live mobile login or sync run is recorded for this exact version; release metadata advanced from 2026.6.0 build 3325 to 2026.6.1 build 3376 on 2026-07-09, and iOS still lacks a physical-device or simulator live smoke in this repository; follow-up live evidence is tracked by HON-65; TOTP login has official CLI plus HTTP auth lifecycle evidence only, with no iOS TOTP evidence recorded yet; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                                                                                                                                                                                                              |
| cli               | 2026.6.0 |       | cli-v2026.6.0     | 2026-06-25T18:32:52Z | live_smoke   | Live CLI smoke covers config, password login, sync, one synthetic login item create/update/trash/permanent-delete flow, account revision lookup, official CLI one-step TOTP login, refresh grant, and HTTP auth lifecycle recent-auth guards; TOTP setup, change, disable, and revoke-all-other-sessions evidence uses direct HTTP routes with CLI-issued or recent password-authenticated tokens because the tracked CLI does not expose those account-management flows in this scope; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                                                                                                                                |

There is intentionally no Web Vault row. HonoWarden's alpha compatibility
target is API-only protocol support for tracked clients, not a hosted or
embedded vault UI. Adding a Web Vault row requires a new ADR, browser security
review, CSP/static-asset provenance rules, deployment and rollback boundaries,
and live evidence.

There is intentionally no Organizations or shared vault row. HonoWarden's alpha
compatibility target is the personal-vault protocol surface. Shared vault
support would require ADR 0005's membership, ownership, role, collection-access,
cross-user isolation, encrypted key sharing, audit, migration, rollback, and
compatibility fixture gates before compatibility can be claimed.

Policy metadata remains fixture-covered as authenticated empty list responses
for personal vaults. Policy mutation and organization policy enforcement are
not compatibility claims; ADR 0006 requires policy schema, enforcement points,
default behavior, audit, rollback, and compatibility fixture design before
support can be claimed.

Collection metadata remains fixture-covered as authenticated empty read-only
responses for personal vaults. Collection mutation and cipher assignment are not
compatibility claims; ADR 0007 requires ownership, membership, assignment,
audit, migration, rollback, and compatibility fixture design before support can
be claimed.

There is intentionally no Send or public file-sharing row. Cipher-scoped
attachments are authenticated owner-scoped vault operations; public sharing
would require ADR 0003's access-token, expiration, revocation, rate-limit,
abuse, cache, and retention controls before compatibility can be claimed.

There is intentionally no Emergency Access row. Delegated recovery requires ADR
0004's grantee identity, delay, cancellation, notification, cryptographic
handoff, abuse-control, audit, rollback, and incident-response design before
compatibility can be claimed.

Attachment sync metadata has fixture coverage through `attachment_metadata`.
Live official-client attachment upload, download, and delete evidence is still
not recorded for any tracked client surface.

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
4. Keep `verificationLevel` unchanged unless new live request/response evidence
   is captured and linked.
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

## Live Evidence

- Desktop `2026.6.1` password-login, approval, and empty-vault evidence: [`docs/release/login-with-device-live-client-evidence.md`](release/login-with-device-live-client-evidence.md)
- Desktop `2026.6.1` historical transport checkpoint: [`docs/release/desktop-notification-transport-evidence.md`](release/desktop-notification-transport-evidence.md)
- Browser extension `2026.6.1`: [`docs/release/browser-extension-live-client-evidence.md`](release/browser-extension-live-client-evidence.md) and [`docs/release/login-with-device-live-client-evidence.md`](release/login-with-device-live-client-evidence.md)
- Android `2026.6.1` build `21713`: [`docs/release/android-mobile-live-client-evidence.md`](release/android-mobile-live-client-evidence.md)
- CLI `2026.6.0`: [`docs/release/live-client-evidence.md`](release/live-client-evidence.md)
- CLI TOTP and recent-auth lifecycle `2026.6.0`: [`docs/release/totp-recent-auth-live-evidence.md`](release/totp-recent-auth-live-evidence.md)
