# Client Compatibility Matrix

Last release metadata check: 2026-07-06T11:35:37Z.

This matrix records the exact client versions currently tracked by HonoWarden. It is intentionally conservative: rows stay at `fixture_only` until a live client run is captured with request and response evidence. The structured source of truth is [`compat/client-matrix.json`](../compat/client-matrix.json).

Fixture coverage is tracked separately in [`compat/fixture-flows.json`](../compat/fixture-flows.json). CI verifies that every `coveredFlows` value in the matrix maps to at least one fixture file. CI also route-replays every JSON fixture under `compat/fixtures` against the Hono app and compares that replay set with the fixture-flow manifest, so fixture assertions exercise real route behavior instead of only static JSON shape.

## Current Matrix

| Surface           | Version  | Build | Release Tag       | Release Published    | Verification | Known Issues                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------- | ----- | ----------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser_extension | 2026.6.1 |       | browser-v2026.6.1 | 2026-06-30T17:07:46Z | fixture_only | No live client login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `GET /api/devices/knowndevice`); encrypted device key update has fixture coverage only.                                       |
| desktop           | 2026.6.1 |       | desktop-v2026.6.1 | 2026-06-30T16:09:04Z | fixture_only | No live client login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `GET /api/devices/knowndevice`); encrypted device key update has fixture coverage only.                                       |
| mobile_android    | 2026.6.0 | 21686 | v2026.6.0-bwpm    | 2026-06-25T21:37:09Z | fixture_only | No live mobile login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `GET /api/devices/knowndevice`); encrypted device key update has fixture coverage only.                                       |
| mobile_ios        | 2026.6.0 | 3325  | v2026.6.0-bwpm    | 2026-06-26T15:03:00Z | fixture_only | No live mobile login or sync run is recorded; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `GET /api/devices/knowndevice`); encrypted device key update has fixture coverage only.                                       |
| cli               | 2026.6.0 |       | cli-v2026.6.0     | 2026-06-25T18:32:52Z | live_smoke   | Live CLI smoke covers config, password login, empty sync, and revision lookup only; TOTP login has local HTTP coverage only; device lookup, metadata update, encrypted key update, and preflight APIs are implemented (`GET /api/devices`, `GET /api/devices/identifier/:identifier`, `PUT /api/devices/:id`, `PUT /api/devices/:id/keys`, `GET /api/devices/knowndevice`); encrypted device key update has fixture coverage only. |

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
