# Desktop Notification Transport Evidence

Status: SignalR transport passed; Desktop vault lifecycle remains pending.

Updated: 2026-07-11.

## Scope

This evidence covers only the notification transport required by the official
Desktop client. It does not claim notification delivery, vault rendering, item
lifecycle compatibility, or broad Desktop support.

Client under test:

- official Desktop version `2026.6.1`, build `64377`;
- Electron `39.8.5`, Chromium `142.0.7444.265`;
- local synthetic account and isolated short HOME path;
- local HTTPS Worker at `https://127.0.0.1:8790` with certificate validation
  disabled only for the local self-signed development certificate.

## Implemented Transport

`GET /notifications/hub` now:

- requires a WebSocket upgrade and returns `426 websocket_required` otherwise;
- accepts a bearer token or SignalR `access_token` query authentication;
- rejects missing and invalid tokens before creating a WebSocket pair;
- acknowledges JSON and MessagePack SignalR version 1 handshakes;
- emits an immediate ping and a 15-second heartbeat;
- clears and replaces heartbeat timers on repeated handshake, close, or error.

The endpoint intentionally implements handshake and heartbeat compatibility
only. It does not publish vault-change notifications.

## Live Readback

The official Desktop client logged:

- `Using SignalR for server notifications`;
- WebSocket connected to `/notifications/hub` with the access token redacted;
- `Using HubProtocol 'messagepack'`.

The local Worker returned:

- `POST /identity/connect/token` 200;
- `GET /api/config` 200;
- `GET /api/sync?excludeDomains=true` 200;
- `GET /notifications/hub` 101 Switching Protocols.

No access token, password, account key, private vault payload, or synthetic
account address is recorded here.

## Automated Verification

`test/app.test.ts` covers:

- non-upgrade 426;
- missing and invalid access-token 401 responses;
- JSON handshake acknowledgement and heartbeat;
- length-prefixed MessagePack ping bytes;
- repeated-handshake timer replacement;
- timer cleanup on close and error.

## Remaining Desktop Gate

The clean-profile Desktop UI did not yet provide verified vault render and item
create/update/delete evidence. The compatibility matrix therefore remains
`fixture_only`. HON-67 owns the short-HOME rerun and full lifecycle evidence;
promotion is prohibited until that issue passes.
