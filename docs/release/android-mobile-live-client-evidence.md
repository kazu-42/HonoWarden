# Android Mobile Live Client Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic Android live smoke

Recorded at: `2026-07-10T02:49:00Z`

Source branch under test: `codex/hon-54-mobile-live-evidence`

Client surface: `mobile_android`

Client version: `2026.6.1`

Client build: `21713`

Package identifier: omitted from tracked source by repository brand policy.

Server: local wrangler dev worker through a temporary trycloudflare tunnel

## Purpose

This evidence records one official Android Password Manager login and
empty-vault sync against the HonoWarden Worker running through wrangler dev
with local D1 state. It is a smoke test, not a full Android regression suite.

The run used a synthetic account, synthetic password, synthetic account keys,
and an empty synthetic vault. No real vault data, real passwords, session
tokens, access tokens, refresh tokens, private keys, API keys, seed phrases, or
recovery codes were recorded.

Real secrets: none

## Asset Provenance

- Android release: `v2026.6.1-bwpm`
- Release name: `Password Manager 2026.6.1 (21713)`
- Release published: `2026-07-09T16:57:30Z`
- Installed asset: upstream Android F-Droid APK
- Installed asset SHA-256:
  `3bd4feb3753147c59d2412c251b1bc4adbc3d7f38a40bd2726d8164502243673`
- Standard APK also checked:
  `b47c39fb2420ba2923a8060f116355be956e2c81b2a1d3ac976bd9b382b9c7fa`
- Package version readback: `versionName=2026.6.1`, `versionCode=21713`

Release metadata was verified with the official upstream Android GitHub release
before the matrix row was promoted.

## Local Topology

- Worker:
  `wrangler dev --local --local-protocol=http --port 8790 --ip 127.0.0.1`
- Local D1: `honowarden`, migrated under ignored
  `test/.tmp/hon-54-mobile-client/wrangler-state`
- Public tunnel:
  `https://adjustable-previously-promotion-dvds.trycloudflare.com`
- Emulator: `honowarden_hon54_api36_arm64`
- Android runtime: Android `16`, SDK `36`, `1080x2400`, density `420`
- Raw evidence paths: ignored files under
  `test/.tmp/hon-54-mobile-client/`

The trycloudflare URL was temporary local evidence plumbing. It is not a
production endpoint and is not a release dependency.

## Seed Data

The account was created through earlier synthetic bootstrap evidence and reused
for the Android smoke:

- email: `person@example.test`
- display name: `HON-52 Synthetic Browser Extension`
- KDF: PBKDF2-SHA256, `600000` iterations
- account keys: official CLI wasm-generated synthetic account material
- vault contents: empty personal vault

The generated wrapped user key, public key, wrapped private key, password hash,
bootstrap token, session key, and tokens were intentionally kept only in
ignored files under `test/.tmp/` and are not committed.

## Server Fixes Validated

The first Android run reached `My vault` but rendered the generic request error.
The server returned `GET /api/sync 200`, but the official Android Retrofit path
rejected `profile.creationDate` values in SQLite `CURRENT_TIMESTAMP` format.
The failing official-source diagnostic showed:

- `DateTimeParseException`
- rejected value shape: `YYYY-MM-DD HH:mm:ss`
- failure point: `SyncResponseJson.Profile.creationDate`

HonoWarden now normalizes outward API timestamps to UTC ISO-8601 before
serializing client responses. The passing live response used
`2026-07-10T01:05:47.000Z`.

## Flow Evidence

Flow: self-hosted environment selection

Result: the Android app saved the temporary trycloudflare URL as the
self-hosted server URL.

Flow: `/api/config`

Result: wrangler dev logged successful `GET /api/config 200 OK` before login
and again after vault load.

Flow: `/api/devices/knowndevice`

Result: wrangler dev logged `GET /api/devices/knowndevice 200 OK`.

Flow: `/identity/accounts/prelogin`

Result: wrangler dev logged `POST /identity/accounts/prelogin 200 OK`.

Flow: `/identity/connect/token`

Result: wrangler dev logged `POST /identity/connect/token 200 OK` for the
password grant. The token response was not recorded.

Flow: `/api/sync`

Result: wrangler dev logged `GET /api/sync 200 OK`; the Android app loaded the
vault screen without the generic request error.

Flow: `/api/account/billing/vnext/subscription`

Result: wrangler dev logged `GET /api/account/billing/vnext/subscription 200
OK`. The response is a zero-cost canceled subscription placeholder used only to
keep the personal-vault smoke path explicit.

Flow: empty-vault render

Result: the final UI dump contained `My vault` and the empty-vault onboarding
text `Import saved logins`; it did not contain `We were unable to process your
request`.

## Readback Evidence

Clean run artifacts:

- UI dump:
  `test/.tmp/hon-54-mobile-client/android-clean-iso-08-final.xml`
- Screenshot:
  `test/.tmp/hon-54-mobile-client/android-clean-iso-08-final.png`
- App data pull:
  `test/.tmp/hon-54-mobile-client/android-clean-iso-appdata/`
- Redacted summary:
  `test/.tmp/hon-54-mobile-client/android-clean-iso-summary.json`

Readback summary:

- `hasUnable=false`
- `hasMyVault=true`
- `hasImportSavedLogins=true`
- `domains=1`
- `folders=0`
- `ciphers=0`
- `collections=0`
- `sends=0`
- active synthetic user id:
  `83b386e6-2480-411c-b194-c1f53bfe5933`
- profile `stamp`: present
- profile `creationDate`: `2026-07-10T01:05:47.000Z`

The `domains=1` row is important because the official Android
`VaultDiskSourceImpl.replaceVaultData` inserts a domains row even for an empty
vault. Its presence proves that sync passed the network parse boundary and
reached local vault persistence.

## Official Source Checks

The official Android source checkout under ignored `test/.tmp/` was used for two
local diagnostics:

- `HonoWardenSyncResponseDecodeTest`: the saved live sync JSON decodes as
  `SyncResponseJson`.
- `HonoWardenLiveSyncApiTest`: the official Retrofit converter and
  `NetworkResultCallAdapterFactory` return `NetworkResult.Success` against the
  live trycloudflare URL.

Both checks passed after timestamp normalization. The broader app-module unit
test could not be run locally because the upstream Android app module requires
GitHub Packages access to a private SDK artifact with a token that has
`read:packages`.

## Observed Server Routes

wrangler dev logged these successful application routes during the clean run:

- `GET /api/config 200`
- `GET /api/devices/knowndevice 200`
- `POST /identity/accounts/prelogin 200`
- `POST /identity/connect/token 200`
- `GET /api/sync 200`
- `GET /api/account/billing/vnext/subscription 200`
- `GET /api/config 200`

## Limits

This evidence does not prove iOS, desktop, browser-extension behavior, Android
TOTP UX, live refresh rotation, live item lifecycle mutation, live device key
or bulk trust update, live attachment upload/download/delete, Organizations,
Send, Web Vault behavior, notification hub behavior, or any public registration
path. Those surfaces remain explicit known limitations until separate live
evidence is recorded.
