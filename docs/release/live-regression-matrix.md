# Live Regression Matrix

Target: `v0.1.0-alpha`.

Status: harness ready, no row promoted to `live_regression`.

The current release has recorded CLI, browser-extension, and Android
`live_smoke` evidence documents. A `live_regression` promotion requires a
repeatable run that covers the broader client lifecycle and stores only
redacted, synthetic evidence.

## Harness

Use the packet generator before running a live regression:

```sh
pnpm live:regression:packet -- \
  --strict \
  --surface cli \
  --client-version 2026.6.0 \
  --environment local \
  --server-url https://localhost:8791 \
  --source-commit <server-commit> \
  --run-id <run-id> \
  --flow config \
  --flow prelogin \
  --flow password_grant \
  --flow initial_sync \
  --flow post_mutation_sync \
  --flow cipher_create \
  --flow cipher_update \
  --flow cipher_soft_delete \
  --flow cipher_permanent_delete \
  --flow refresh_grant \
  --flow session_revoke \
  --flow device_revoke
```

The packet records:

- exact client surface, version, build, and release tag from the compatibility
  matrix;
- environment kind, server URL without credentials or query values, source
  commit, run id, and evidence directory;
- required regression flow coverage;
- redacted evidence file paths expected under
  `docs/release/live-regression-evidence/`;
- limitations that make the packet safe to run before any live client binary is
  started.

## Required Flow Groups

Every `live_regression` run must cover these groups:

- login: config, prelogin, and password grant;
- sync: initial sync and a post-mutation sync;
- item lifecycle: create, update, soft delete, and permanent delete;
- refresh: refresh grant;
- session revoke: session revocation observed by the client;
- selected auth lifecycle: at least one of TOTP login, device revoke,
  revoke-all-other-sessions, or disabled-user denial.

The selected auth lifecycle slot exists because not every client surface exposes
the same auth-management affordances. The run must still name the selected flow
and keep raw token, password, and vault payload data out of evidence.

## Evidence Rules

Evidence must stay synthetic-only:

- no real vault data;
- no real passwords;
- no access tokens, refresh tokens, session keys, private keys, seed phrases, or
  recovery codes;
- no raw request or response bodies;
- no screenshots that expose personal data;
- no private forwarding destinations or unrelated operator account data.

Allowed evidence includes route names, status codes, redacted timestamps,
synthetic ids, client version strings, source commit, run id, and pass/fail
summaries.

## Promotion Rules

The compatibility matrix distinguishes the levels as follows:

- `fixture_only`: CI verifies synthetic fixtures and route replay only.
- `live_smoke`: a real client completed a narrow login/sync smoke with redacted
  evidence.
- `live_regression`: a real client completed all required regression flow groups
  with redacted evidence and a ready packet from
  `pnpm live:regression:packet -- --strict`.

Do not promote a matrix row to `live_regression` unless the evidence summary and
packet are committed and the row's `liveEvidence.flows` includes the required
flow ids used for that run.

## Current Status

No tracked client row is promoted to `live_regression` yet. Browser extension,
Android, and CLI remain `live_smoke`; desktop and iOS remain `fixture_only`.
CLI remains below `live_regression` until a repeatable run records refresh,
session revoke, and selected auth lifecycle evidence in addition to the
existing item lifecycle smoke.
