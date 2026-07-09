# Week 26 TOTP Secret Rotation Tooling

Goal: close `HON-44` by adding dry-run-first tooling for
`HONOWARDEN_TOTP_SECRET` envelope rotation without running a live secret
rotation.

Success criteria:

- dry-run reports affected `user_totp` rows without logging plaintext or
  encrypted envelopes
- rewrap can re-encrypt active and pending TOTP envelopes with a new wrapping
  secret
- force re-enrollment is available as an explicit destructive strategy
- missing old/new secret inputs, corrupt active envelopes, and corrupt pending
  envelopes fail closed
- rollback and partial-failure handling are documented

Verification:

- `pnpm exec vitest run test/ops/totp-secret-rotation.test.ts`
- `pnpm check`
- `pnpm lint`
- full checks before PR closeout
