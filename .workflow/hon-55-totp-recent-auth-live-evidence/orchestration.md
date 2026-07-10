# HON-55 TOTP And Recent-Auth Live Evidence Orchestration

## Packets

### 01-local-worker-and-seed

- Start local wrangler dev with isolated ignored D1 state.
- Apply local migrations.
- Load or create a synthetic account using ignored test material.

### 02-cli-one-step-totp

- Enable TOTP through authenticated local HTTP setup routes.
- Wait for a fresh TOTP timestep after setup verification.
- Run the official CLI `bw login --method 0 --code` against the local Worker.
- Record only session key length and a redacted digest.

### 03-http-auth-lifecycle

- Prove challenge-backed TOTP login still works.
- Prove refresh grant works after TOTP login.
- Prove refresh-auth tokens are rejected by recent-auth routes.
- Prove revoke-all-other-sessions, TOTP change, and TOTP disable succeed with a
  recent password-authenticated token.

### 04-docs-matrix-gate

- Add the redacted release evidence document.
- Link the evidence through `compat/client-matrix.json`.
- Extend the release gate so a claimed CLI `totp_login` flow requires the
  TOTP/recent-auth evidence markers.

### 05-verification

- Run focused app, compatibility, release-gate, and docs tests.
- Run full project verification before opening the PR.

## Failure Handling

- If the official CLI cannot complete login, keep the issue open and record the
  exact redacted CLI/server failure.
- If a recent-auth route accepts a refresh-auth token, stop and fix that
  security regression before updating docs.
- If evidence would require real user secrets or production data, stop and
  split a separate approved operational packet.
