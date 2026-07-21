# RECOVERY-1B: Fresh Restore And Stale-Generation Rejection

Linear parent: HON-221

Linear issue: HON-225; blocked by HON-224

## Goal

Restore the approved generation-bound backup into owned fresh persistence and
prove that only the final credential/session generation remains usable.

## Deliverables

- Create a mode-0700 run-owned target and reject non-empty, symlinked,
  unowned, or previously initialized persistence before restore.
- Restore the approved D1 dump and every R2 object, then compare canonical D1
  and R2 content digests with the source snapshot.
- Reject every captured pre-final password, access token, refresh token, and
  official-client profile using secret material retained only in process or
  ignored private runtime state.
- Complete a fresh pinned official-client login, unlock, sync, and decrypted
  item read against the restored final generation.
- Add focused unit/fault tests plus one real local Wrangler restore run with
  bounded cleanup and a committed redacted result.

## Invariants And Failure Modes

- Freshness is verified, not inferred from an operator confirmation flag.
- Source and target are distinct owned roots. The restore cannot mutate the
  source lifecycle state or ambient repository persistence.
- Equality covers database content and R2 bytes rather than filenames or row
  counts alone.
- Raw stale/current credentials never enter command arguments, stdout,
  manifests, result JSON, or tracked files.

## Exit Gate

The restored target is byte-equivalent at the D1/R2 content boundary, rejects
all pre-final authorization material before and after Worker restart, and
passes current official-client decrypt readback. The reviewed exact head is
merged, main CI is green, and the Linear child is Done/archived before
`RECOVERY-1C` starts.

## Safety Boundary

Local synthetic state only. No remote D1/R2 mutation, deployment, real
credential, destructive operation, paid action, or third-party contact.
