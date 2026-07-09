# TOTP Secret Rotation

Last reviewed: 2026-07-09.

Status: tooling-supported. No live production `HONOWARDEN_TOTP_SECRET`
rotation drill has been executed yet.

This runbook covers the dry-run-first operator CLI for rotating the wrapping
secret used by `user_totp.encrypted_secret` and
`user_totp.pending_encrypted_secret`.

## Runtime Contract

- Runtime login/setup continues to read `HONOWARDEN_TOTP_SECRET`.
- The rotation CLI uses local-only operator inputs:
  - `HONOWARDEN_TOTP_OLD_SECRET`
  - `HONOWARDEN_TOTP_NEW_SECRET`
- Dry-run output contains counts, status, redacted command metadata, and
  decision points only.
- Dry-run and execution output must not print plaintext TOTP secrets, encrypted
  TOTP envelopes, wrapping secret values, bearer tokens, or user vault data.
- The CLI does not set Wrangler secrets, deploy Workers, or change live runtime
  variables by itself.

## Strategies

### Rewrap

`rewrap` decrypts each stored TOTP envelope in memory with the old wrapping
secret, immediately re-encrypts it with the new wrapping secret, and updates
`user_totp` rows only during `--execute`.

It preserves:

- enabled TOTP state
- verified timestamp
- last accepted timestep replay guard
- pending TOTP change state, when `pending_encrypted_secret` exists

It blocks execution when any active or pending envelope cannot be decrypted with
the old secret. In that case, do not partially rotate. Decide whether to
recover the old secret, restore from backup, or use the force re-enrollment
strategy.

### Force Re-Enrollment

`force-reenrollment` deletes affected `user_totp` rows so users must set up
TOTP again. It does not require the old or new wrapping secret, but it is a
destructive authentication-policy change and needs explicit incident lead or
operator approval.

Use this only when:

- the old wrapping secret is unavailable or confirmed compromised
- rewrap is blocked by corrupt envelopes and backup recovery is rejected
- the operator has an approved user communication and re-enrollment plan

## Dry Run

Dry-run with a read-only D1 query:

```sh
pnpm totp:rotate-secret -- \
  --database honowarden \
  --mode remote \
  --env production \
  --reason planned-rotation-20260709 \
  --old-secret-env HONOWARDEN_TOTP_OLD_SECRET \
  --new-secret-env HONOWARDEN_TOTP_NEW_SECRET
```

Dry-run reads `user_totp`, validates envelope decryptability in memory, and
prints a JSON packet. Review:

- `status`
- `blockingReason`
- `summary.totalRows`
- `summary.decryptableActiveRows`
- `summary.decryptablePendingRows`
- `summary.corruptActiveRows`
- `summary.corruptPendingRows`
- `summary.plannedUpdates`
- `mutationPreview.sqlRedacted`

If `status` is `not_ready`, do not execute the rewrap.

## Execute Rewrap

After reviewing the dry-run packet and recording operator approval:

```sh
pnpm totp:rotate-secret -- \
  --database honowarden \
  --mode remote \
  --env production \
  --reason planned-rotation-20260709 \
  --old-secret-env HONOWARDEN_TOTP_OLD_SECRET \
  --new-secret-env HONOWARDEN_TOTP_NEW_SECRET \
  --execute \
  --confirm honowarden:rewrap
```

Then set the Worker runtime `HONOWARDEN_TOTP_SECRET` to the new value using the
approved Wrangler secret process and deploy or roll the Worker according to the
current release procedure. This CLI intentionally does not perform that secret
write.

## Execute Force Re-Enrollment

Dry-run first:

```sh
pnpm totp:rotate-secret -- \
  --database honowarden \
  --mode remote \
  --env production \
  --strategy force-reenrollment \
  --reason old-secret-lost
```

Execute only after explicit approval:

```sh
pnpm totp:rotate-secret -- \
  --database honowarden \
  --mode remote \
  --env production \
  --strategy force-reenrollment \
  --reason old-secret-lost \
  --execute \
  --confirm honowarden:force-reenrollment
```

## Rollback And Partial Failure

For rewrap:

- Before changing the Worker runtime secret, rollback is to rerun rewrap in the
  opposite direction using the old and new inputs swapped.
- After changing the Worker runtime secret, rollback requires restoring the old
  runtime secret and rerunning the opposite rewrap, or restoring a pre-rotation
  D1 backup into a fresh target.
- If execution fails partway through, stop. Use the pre-execution dry-run
  packet, D1 backup, and post-failure readback to decide whether to rerun
  rewrap, reverse already-updated rows, or force re-enrollment.

For force re-enrollment:

- rollback requires restoring `user_totp` rows from backup; do not invent TOTP
  secrets or write placeholder envelopes
- user communication is required because users will need to set up TOTP again

## Evidence To Record

Record:

- issue ID, owner, environment, UTC timestamp, and source commit
- strategy and reason
- dry-run packet summary
- `status` and `blockingReason`
- execution approval and command shape
- post-operation login/TOTP smoke with synthetic data
- rollback decision

Do not record:

- `HONOWARDEN_TOTP_OLD_SECRET`
- `HONOWARDEN_TOTP_NEW_SECRET`
- runtime `HONOWARDEN_TOTP_SECRET` value
- plaintext TOTP base32 secrets
- encrypted TOTP envelopes
- bearer/refresh tokens
- private user data or vault payloads
