# TOTP Secret Rotation

Last reviewed: 2026-09-01.

Status: dry-run and local planning supported. Remote mutation is statically
disabled. No live production `HONOWARDEN_TOTP_SECRET` rotation drill has been
executed.

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
- Any `--mode remote --execute` invocation fails before reading secret
  environment variables, loading input, constructing SQL, starting Wrangler or
  another child process, or making a network request.

## Strategies

### Rewrap

`rewrap` planning decrypts each stored TOTP envelope in memory with the old
wrapping secret and immediately re-encrypts it with the new wrapping secret.
Local execution remains available for isolated development verification. Remote
execution is disabled because changing D1 envelopes without an atomic runtime
secret activation and recovery protocol can make every migrated TOTP credential
unreadable by the live Worker.

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

`force-reenrollment` planning counts the `user_totp` rows that would need to be
deleted so users can set up TOTP again. It does not require the old or new
wrapping secret. Remote deletion is disabled because it is a destructive
authentication-policy change that cannot be recovered without a verified backup
and a coordinated user re-enrollment plan.

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

If `status` is `not_ready`, do not use the plan for local execution. Remote
execution remains blocked regardless of status.

## Remote Execution Boundary

Remote execution is intentionally unavailable for both strategies. The CLI
returns this fixed error for every `--mode remote --execute` invocation:

```text
Remote TOTP rotation execution is disabled until secret activation and recovery are implemented.
```

The static boundary is evaluated immediately after argument parsing. It does not
inspect `HONOWARDEN_TOTP_OLD_SECRET`, `HONOWARDEN_TOTP_NEW_SECRET`, or ambient
Cloudflare credentials, and it does not read D1, build mutation SQL, invoke
Wrangler, or contact Cloudflare.

Do not bypass this boundary with direct Wrangler or D1 commands. Before remote
execution can be implemented, one reviewed protocol must cover all of these
invariants:

- a dual-key or otherwise atomic runtime transition so both pre-rotation and
  post-rotation envelopes remain decryptable throughout activation
- explicit ordering for config activation, database migration, application
  rollout, verification, and retirement of the old key
- a pre-mutation backup plus a restore/readback procedure whose safety is
  established before admission for both D1 rows and runtime configuration
- resumable, idempotent row migration with exact progress and partial-failure
  accounting
- synthetic staging proof followed by an explicit production authority gate
- post-activation login/TOTP smoke, observability, and stop/rollback criteria
- for force re-enrollment, exact affected-user scope, an explicitly authorized
  communication plan, access recovery, and restoration evidence

## Recovery And Partial-Failure Design

The current CLI performs no remote mutation, so a blocked invocation needs no
rollback. Keep the following recovery requirements as design constraints for a
future implementation; they are not authorization to execute the procedure
manually.

For rewrap:

- Keep the old runtime key available until exact readback shows that the new
  runtime can decrypt every migrated active and pending envelope.
- A partial row migration must be resumable without double mutation and must not
  require guessing which runtime key owns an envelope.
- Recovery must restore runtime configuration and D1 data to a mutually
  compatible point; restoring only one side can prolong the authentication
  outage.

For force re-enrollment:

- recovery requires restoring `user_totp` rows from a backup whose integrity
  and restorability were established before any deletion; do not invent TOTP
  secrets or write placeholder envelopes
- user communication and an access-recovery path are required before users are
  made to set up TOTP again

## Evidence To Record

Record:

- issue ID, owner, environment, UTC timestamp, and source commit
- strategy and reason
- dry-run packet summary
- `status` and `blockingReason`
- the static STOP result for any attempted remote execution
- the review/authority decision for a future end-to-end transition protocol
- planned post-operation login/TOTP smoke with synthetic data
- planned stop and rollback criteria

Do not record:

- `HONOWARDEN_TOTP_OLD_SECRET`
- `HONOWARDEN_TOTP_NEW_SECRET`
- runtime `HONOWARDEN_TOTP_SECRET` value
- plaintext TOTP base32 secrets
- encrypted TOTP envelopes
- bearer/refresh tokens
- private user data or vault payloads
