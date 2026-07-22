# RECOVERY-1C: Default-Off Writers And Forward Recovery

Linear parent: HON-221

Linear issue: HON-226; HON-225 predecessor gate satisfied

## Goal

Prove every credential writer is an explicit D1-free no-op while disabled,
then re-enable the same restored target and commit exactly one new forward
credential generation.

## Deliverables

- Add an explicit default-off password-change feature flag so password change,
  KDF mutation, account-key initialization, and complete user-key rotation all
  share the tracked rollout boundary.
- Run each disabled writer against the exact restored target and require the
  unsupported response before authentication, D1 reads, or D1 writes.
- Compare canonical D1 and R2 content hashes before and after every disabled
  request.
- Re-enable the isolated local Worker, authenticate with the restored current
  generation, and complete one forward credential mutation.
- Prove one security-stamp/revision/audit advancement, current official-client
  decrypt readback, and rejection of both pre-final and pre-recovery material.

## Invariants And Failure Modes

- Tracked local, staging, and production configuration remains default-off for
  all four writers.
- Disabled verification and forward recovery bind the same persistence path;
  no restore reset may occur between phases.
- The recovery mutation is authenticated by the restored current generation
  and commits atomically exactly once. Retry or concurrency cannot create a
  second generation or audit row.
- Failures are observable and leave D1/R2 unchanged; no silent fallback can
  downgrade recovery to an older generation.

## Exit Gate

All four disabled routes are D1-free unsupported no-ops on the restored target.
One re-enabled forward mutation advances stamp, revision, and audit exactly
once; the resulting official-client read succeeds, and all prior generations
remain rejected after restart. The reviewed exact head is merged, main CI is
green, and the Linear child is Done/archived before HON-221 integration
closeout.

## Safety Boundary

Local synthetic state only. No remote D1/R2 mutation, deployment, production
activation, real credential, destructive operation, paid action, or
third-party contact.
