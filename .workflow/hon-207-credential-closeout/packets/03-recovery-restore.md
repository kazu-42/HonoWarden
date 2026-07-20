# RECOVERY-1: Restore, Disable, And Forward Recovery

## Deliverables

- Exact final-generation local D1/R2 backup and redacted manifest identity.
- Fresh-target restore using the existing backup CLI.
- Rejection of every pre-final credential/session after restore.
- Disabled mutation routes with byte-equivalent persisted state.
- Re-enabled forward credential mutation and post-recovery client readback.

## Exit Gate

The approved post-generation manifest restores one current generation without
reviving older authorization or vault state. A mismatched/historical manifest
fails before restore execution.
