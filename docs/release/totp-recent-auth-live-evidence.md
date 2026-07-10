# TOTP And Recent-Auth Live Evidence

Target: `v0.1.0-alpha`.

Status: passed

Mode: local synthetic CLI plus HTTP auth lifecycle smoke

Recorded at: `2026-07-09T23:52:00Z`

Issue: `HON-55`

Client surface: `cli`

Client version: `2026.6.0`

Server: local wrangler dev worker

## Purpose

This evidence records one synthetic TOTP and recent-auth lifecycle run against
the HonoWarden Worker using local wrangler dev and local D1 state. The run
proves the official CLI one-step TOTP password grant and uses direct HTTP
requests for account-management routes that are not exposed by the tracked CLI
surface in this scope.

The run used a synthetic account, synthetic password, synthetic TOTP secret,
synthetic account keys, and local D1 state only. No production Worker, remote
D1 database, real vault data, real passwords, access tokens, refresh tokens,
session keys, TOTP seeds, private keys, API keys, recovery codes, or personal
mailbox data were recorded.

Real secrets: none

## Local Topology

- Worker: `wrangler dev --local --local-protocol=https --port 8790 --ip 127.0.0.1`
- Local D1: `honowarden`, migrated under ignored
  `test/.tmp/hon-55-totp-recent-auth/wrangler-state`
- CLI binary: official `bw` macOS arm64 binary from `cli-v2026.6.0`
- CLI state: ignored directory under
  `test/.tmp/hon-55-totp-recent-auth/cli-state`
- Raw redacted evidence: ignored file
  `test/.tmp/hon-55-totp-recent-auth/evidence/totp-recent-auth-live.redacted.json`

The local CLI invocation disabled TLS certificate verification only for the
self-signed local wrangler endpoint. That warning is expected in this local
evidence mode and must not be reused for staging or production evidence.

## Seed Data

The synthetic account was created through `POST /api/accounts/bootstrap`
against the local Worker. The bootstrap request used the ignored synthetic
account material created for previous official-client evidence, then enabled
TOTP through the authenticated setup routes in this run.

The generated wrapped user key, public key, wrapped private key, password hash,
bootstrap token, TOTP seed, session key, access token, and refresh token stayed
in ignored files under `test/.tmp/` and are not committed.

## Flow Evidence

Flow: `POST /api/accounts/bootstrap`

Result: local synthetic account bootstrap returned HTTP `201`.

Flow: `/identity/connect/token`

Result: password grant before TOTP enablement returned HTTP `200` and produced
a recent password-authenticated token for setup.

Flow: `/identity/accounts/totp/setup`

Result: setup start returned HTTP `200` with synthetic setup material.

Flow: `/identity/accounts/totp/setup/verify`

Result: setup verify returned HTTP `200` and enabled TOTP for the synthetic
account.

Flow: official CLI one-step TOTP password grant

Result: `bw login --method 0 --code` against the local server returned a raw
session key. The session key length was `88`, and its redacted SHA-256 digest
was `477d5ed7048108221ad82c8af05fa3e5e2f84a7e6adcc9ac646dd2f15a87488a`.

CLI login result: session key length 88

The official CLI sent the OTP code in the password grant's TOTP token field.
HonoWarden now accepts that one-step shape while preserving the existing
challenge-backed token plus code path.

Flow: challenge-backed `/identity/connect/token` TOTP login

Result: a password grant without TOTP code returned the expected HTTP `400`
TOTP challenge, and the follow-up challenge plus TOTP code returned HTTP `200`.

Flow: refresh grant after TOTP login

Result: refresh grant returned HTTP `200`, producing a refresh-auth token used
to validate recent-auth rejection behavior.

Flow: `/identity/accounts/totp/disable`

Recent-auth rejection: refresh-auth token returned `reauth_required`

Result: calling TOTP disable with the refresh-auth token returned HTTP `401`
with the expected `reauth_required` error. Calling the same route with a recent
password-authenticated token returned HTTP `200` at the end of the run.

Flow: `/api/devices/revoke-all`

Result: revoke-all-other-sessions with a recent password-authenticated token
returned HTTP `200` and preserved the current synthetic session.

Flow: `/identity/accounts/totp/change`

Result: change start with a recent password-authenticated token returned HTTP
`200`.

Flow: `/identity/accounts/totp/change/verify`

Result: change verify returned HTTP `200` and promoted the replacement TOTP
secret for the synthetic account.

## Observed Route Summary

The redacted run recorded these application observations:

- `POST /api/accounts/bootstrap 201`
- `POST /identity/connect/token 200`
- `POST /identity/accounts/totp/setup 200`
- `POST /identity/accounts/totp/setup/verify 200`
- `POST /identity/connect/token 400`
- `POST /identity/connect/token 200`
- `POST /identity/connect/token 200`
- `POST /identity/accounts/totp/disable 401`
- `POST /api/devices/revoke-all 200`
- `POST /identity/accounts/totp/change 200`
- `POST /identity/accounts/totp/change/verify 200`
- `POST /identity/accounts/totp/disable 200`

The runner waited for a new 30-second TOTP timestep after setup verify, after
official CLI login, and after the challenge-backed HTTP login. That preserves
the server replay invariant: a TOTP step that was already accepted for the
account must not be accepted again.

## Compatibility Finding

The existing server behavior supported a challenge-backed TOTP password grant:
the client first received a server-issued TOTP challenge token, then returned
that challenge token plus a six-digit TOTP code. The official CLI `2026.6.0`
used a second valid shape for this smoke: it sent the six-digit TOTP code as
the TOTP token value in a single password grant. The Worker now supports both
request shapes:

- challenge-backed token plus code for clients that round-trip the server
  challenge;
- one-step code-only TOTP grant for the official CLI shape observed here.

The replay guard, encrypted TOTP secret storage, device-bound challenge
validation, and recent-auth guard remain in force.

## Limits

This evidence does not prove browser-extension, desktop, Android, or iOS TOTP
UX. It also does not prove a real client UI for TOTP setup, TOTP change, TOTP
disable, or revoke-all-other-sessions. Those account-management routes were
validated with direct HTTP calls because the tracked CLI smoke does not expose
those management flows in this scope.

This evidence does not use production resources and does not establish a
`live_regression` matrix promotion. Broader live regression still requires the
repeatable packet in `docs/release/live-regression-matrix.md` plus redacted
evidence for login, sync, item lifecycle, refresh, session revoke, and selected
auth lifecycle flows.
