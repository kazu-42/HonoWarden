# Client Compatibility Matrix

Last release metadata check: 2026-07-09T21:22:47Z.

This matrix records the exact client versions currently tracked by HonoWarden. It is intentionally conservative: rows stay at `fixture_only` until a live client run is captured with request and response evidence. The structured source of truth is [`compat/client-matrix.json`](../compat/client-matrix.json).

Fixture coverage is tracked separately in [`compat/fixture-flows.json`](../compat/fixture-flows.json). CI verifies that every `coveredFlows` value in the matrix maps to at least one fixture file. CI also route-replays every JSON fixture under `compat/fixtures` against the Hono app and compares that replay set with the fixture-flow manifest, so fixture assertions exercise real route behavior instead of only static JSON shape.

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

| Surface           | Version  | Build | Release Tag       | Release Published    | Verification | Known Issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------- | ----- | ----------------- | -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser_extension | 2026.6.1 |       | browser-v2026.6.1 | 2026-06-30T17:07:46Z | fixture_only | No live client login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                |
| desktop           | 2026.6.1 |       | desktop-v2026.6.1 | 2026-06-30T16:09:04Z | fixture_only | No live client login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                |
| mobile_android    | 2026.6.1 | 21713 | v2026.6.1-bwpm    | 2026-07-09T16:57:30Z | fixture_only | No live mobile login or sync run is recorded for this exact version; release metadata advanced from 2026.6.0 build 21686 to 2026.6.1 build 21713 on 2026-07-09, so live mobile evidence must be re-run before any promotion; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only. |
| mobile_ios        | 2026.6.0 | 3325  | v2026.6.0-bwpm    | 2026-06-26T15:03:00Z | fixture_only | No live mobile login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                                                                |
| cli               | 2026.6.0 |       | cli-v2026.6.0     | 2026-06-25T18:32:52Z | live_smoke   | Live CLI smoke covers config, password login, empty sync, and revision lookup only; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, bulk trust update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `POST /api/devices/update-trust`, `GET /api/devices/knowndevice`); device key and bulk trust updates have fixture coverage only.                                                                                                                                          |

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
- `live_regression`: repeated real client runs cover login, sync, create, update, delete, refresh, and session revoke flows.

## Promotion Rules

1. Do not promote a row beyond `fixture_only` without live request and response evidence linked from `compat/client-matrix.json`.
2. Record exact client version, build number where available, local server commit, test date, and known issues.
3. Do not capture real secrets, vault exports, passwords, token values, or personal vault data.
4. Keep unsupported feature behavior explicit; do not mark a client as broadly compatible when a required flow is untested.
5. When upstream release metadata advances, update the exact row metadata first,
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
6. Run `pnpm compat:test`, `pnpm test`, and `pnpm brand:scan` before merging.

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

- CLI `2026.6.0`: [`docs/release/live-client-evidence.md`](release/live-client-evidence.md)
