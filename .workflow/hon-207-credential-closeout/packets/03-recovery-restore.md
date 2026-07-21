# RECOVERY-1: Restore, Disable, And Forward Recovery

Status: integration parent; execute `RECOVERY-1A`, `RECOVERY-1B`, and
`RECOVERY-1C` in order.

Linear parent: HON-221

## Execution Order

```text
RECOVERY-1A -> RECOVERY-1B -> RECOVERY-1C -> RECOVERY-1 integration gate
```

## Deliverables

- `03a-generation-bound-backup.md`: exact final-generation local D1/R2 backup
  and redacted manifest identity.
- `03b-fresh-restore.md`: fresh-target restore, D1/R2 equality, rejection of
  every pre-final credential/session, and current official-client readback.
- `03c-disable-forward-recovery.md`: disabled mutation routes with unchanged
  persistence, one re-enabled forward mutation, and post-recovery client
  readback.

## Integration Invariants

- Only an export bound to the approved final generation may enter restore.
- Restore writes only to a private, run-owned, verified-fresh local target.
- No raw password, token, session, wrapped key, decrypted vault value, or
  personal identity appears in manifests, evidence, stdout, or tracked files.
- Disabled and enabled Workers bind the same restored persistence. A second
  restore or an alternate target cannot substitute for equality proof.
- Recovery advances the credential generation. It never re-enables an older
  generation or treats a historical backup as credential rollback.

## Exit Gate

The approved post-generation manifest restores one current generation without
reviving older authorization or vault state. A mismatched or historical
manifest fails before restore execution. All four credential writers are
default-off and D1-free while disabled. Re-enabling the isolated local Worker
commits exactly one audited forward generation, after which both pre-final and
pre-recovery credentials remain rejected.
