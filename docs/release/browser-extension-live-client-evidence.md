# Browser Extension Live Client Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic browser-extension live smoke

Recorded at: `2026-07-09T23:23:19Z`

Source commit under test: `56a1285`

Client surface: `browser_extension`

Client version: `2026.6.1`

Extension host: Brave Browser, Chromium protocol `Chrome/150.0.7871.63`

Server: local wrangler dev worker

## Purpose

This evidence records one official browser-extension login and empty-vault load
against the HonoWarden Worker running through wrangler dev with local D1 state.
It is a smoke test, not a full browser-extension regression suite.

The run used a synthetic account, synthetic password, synthetic account keys,
and an empty synthetic vault. No real vault data, real passwords, session
tokens, access tokens, refresh tokens, private keys, API keys, seed phrases, or
recovery codes were recorded.

Real secrets: none

## Asset Provenance

- Browser release: `browser-v2026.6.1`
- Browser asset: `dist-chrome-2026.6.1.zip`
- Browser asset SHA-256:
  `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e`
- Browser manifest version: `2026.6.1`
- Browser manifest type: Manifest V3 with background service worker
- CLI release used for synthetic-account crypto: `cli-v2026.6.0`
- CLI npm-build asset SHA-256:
  `31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660`
- CLI macOS arm64 asset SHA-256:
  `57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4`

The synthetic account keys were generated with the official CLI wasm crypto
bundle before account bootstrap. The wrapped user key and wrapped private key
round-tripped through the upstream decrypt paths before the account was used by
the browser extension.

## Local Topology

- Worker: `wrangler dev --local --local-protocol=https --port 8790 --ip 127.0.0.1`
- Local D1: `honowarden`, migrated under ignored
  `test/.tmp/hon-52-browser-extension/wrangler-state`
- Extension server URL: `https://127.0.0.1:8790`
- Extension install mode: unpacked official release asset loaded into a fresh
  Brave profile with remote debugging enabled
- Raw evidence paths: ignored files under
  `test/.tmp/hon-52-browser-extension/evidence/`

The installed branded Chrome build on this workstation did not expose the
unpacked extension under the local evidence flags. Brave's Chromium extension
host did load the same official browser-extension artifact and provided CDP
network and DOM evidence. This is a local evidence-host constraint; it is not a
server runtime dependency.

## Seed Data

The account was created through `POST /api/accounts/bootstrap` against the
local Worker. The bootstrap payload used:

- email: `person@example.test`
- display name: `HON-52 Synthetic Browser Extension`
- KDF: PBKDF2-SHA256, `600000` iterations
- account keys: official CLI wasm-generated synthetic account material
- vault contents: empty personal vault

The generated wrapped user key, public key, wrapped private key, password hash,
bootstrap token, session key, and tokens were intentionally kept only in
ignored files under `test/.tmp/` and are not committed.

## Flow Evidence

Flow: self-hosted environment selection

Result: the extension saved `https://127.0.0.1:8790` as the account host. The
account switcher displayed host `127.0.0.1:8790` for the active synthetic
account after login.

Flow: `/api/config`

Result: CDP recorded two successful foreground fetches returning `200 OK`.

Flow: `/identity/accounts/prelogin/password`

Result: CDP recorded a successful `POST` returning `200 OK`.

Flow: `/identity/connect/token`

Result: CDP recorded a successful password-grant `POST` returning `200 OK`.

Flow: `/api/sync`

Result: wrangler dev logged `GET /api/sync 200 OK` in the same browser-extension
login run after the password grant. The foreground popup CDP target recorded
the login/profile fetches; route-level wrangler logging provided the sync
evidence for the background extension fetch.

Flow: `/api/accounts/profile`

Result: CDP recorded successful `GET` responses returning `200 OK` during the
post-login vault load and again after a popup reload.

Flow: empty-vault render

Result: the popup reached
`chrome-extension://[extension-id]/popup/index.html#/tabs/vault`, showed the
synthetic account, rendered the empty-vault state, and reported the vault as
loaded.

Console and runtime exceptions: `0`

## Observed Server Routes

wrangler dev logged these successful application routes during the run:

- `POST /api/accounts/bootstrap 201`
- `POST /identity/connect/token 200`
- `GET /api/config 200`
- `POST /identity/accounts/prelogin/password 200`
- `POST /identity/connect/token 200`
- `GET /api/sync 200`
- `GET /api/accounts/profile 200`

The extension also requested `/notifications/hub`, which returned `404`. That
route is outside the current personal-vault smoke claim and did not block the
vault from loading.

## Limits

This evidence does not prove desktop app, Android, iOS, official branded Chrome
extension-host behavior, live TOTP login, live refresh rotation, live device
key or bulk trust update, live attachment upload/download/delete, live item
lifecycle mutation, Organizations, Send, Web Vault behavior, notification hub
behavior, or any public registration path. Those surfaces remain explicit known
limitations until separate live evidence is recorded.
