# RECOVERY-1: Restore, Disable, And Forward Recovery

Status: completed; all three subpackets merged, verified on exact main, Done,
and archived

Linear parent: HON-221

## Start Readback

- source main: `7443d3daee70d09b015c864da6033ff3246d0f75`
- predecessor HON-220: Done and archived
- parent HON-221: Todo at initial readback
- successors HON-222 and HON-223: Todo
- production mutation, remote D1/R2 writes, real credentials, deployment,
  destructive operations, paid actions, and third-party contact remain
  excluded

## Decomposition

| Order | Packet      | Linear  | Boundary                                     |
| ----- | ----------- | ------- | -------------------------------------------- |
| 1     | RECOVERY-1A | HON-224 | generation-bound backup and preflight reject |
| 2     | RECOVERY-1B | HON-225 | fresh restore and stale-generation reject    |
| 3     | RECOVERY-1C | HON-226 | disabled no-op and one forward recovery      |

The three children are serialized. Each child must pass focused/full gates,
exact-head standard and five-axis review, PR/head CI, squash tree equality,
merged-main CI, and Linear Done/archive before the next child starts.

## Initial Design Readback

- Wrangler local D1 export does not accept `--persist-to`; an owned temporary
  config must anchor export to the lifecycle source persistence instead of the
  repository's ambient `.wrangler/state`.
- Restore needs explicit expected manifest and expected generation digests.
  Mismatch checks must run before D1 import or R2 put execution.
- Stale credential material must stay in process or ignored mode-0700 state;
  committed evidence remains labels, counts, statuses, and digests only.
- Password change is the only one of the four credential writers without a
  tracked default-off flag. RECOVERY-1C adds that rollout boundary and verifies
  all four disabled routes against the exact same restored state.
- Fresh restore must verify target ownership and emptiness, canonical D1/R2
  equality, stale credential/session rejection, and pinned official-client
  decrypt readback before forward recovery begins.

## Completion Readback

- HON-224 / PR #112 merged as
  `27388e56e54c8b7bd67249bc9cf4fea5401d3a7a`; merged-main CI run
  `29817789762` passed; Linear Done and archived.
- HON-225 / PR #113 merged as
  `c1e2f7c8befb4c85030d48e9b7171fb5599761c2`; merged-main CI run
  `29874991552` passed; Linear Done and archived.
- HON-226 / PR #114 merged as
  `13f4e895d69b2c2485a10a82d1793cf60e148024`; merged-main CI run
  `29886146230` passed; Linear Done and archived.
- All three squash merge trees matched their final branch trees, and each
  child had zero unresolved GitHub review threads before closeout.
- The integrated same-target proof keeps all four writers D1-free while
  disabled, preserves complete D1/R2 identity, commits exactly one forward
  generation, rejects replay and all five prior generations, and completes
  pinned official CLI item readback before and after restart.
- HON-221 moved to Done only after all three children were Done and archived;
  it was archived at `2026-07-22T02:41:53.724Z` with an aggregate evidence
  checkpoint.

No deployment, remote mutation, real credential, production or staging
activation, destructive operation, paid action, or third-party contact was
performed.

## Linear Plan Readback

- synchronized at `2026-07-21T04:43:40.259Z`
- active non-archived HonoWarden issues after creation: 99
- HON-221: In Progress with all six managed labels
- HON-224: In Progress; description SHA-256
  `ee3e5052fa91ade37cd7ce023e19bf373e78aac3d8b6b3affeb244f51a912edc`
- HON-225: Todo; description SHA-256
  `0d173b213ec9b93ec8f32a211020ffd50ac6dca056932f24c49b242c8e04eecf`
- HON-226: Todo; description SHA-256
  `4482a3e85024deb7072d3b77d809ff0b3057c88366637612243c44102b68316a`
- block relations: HON-224 -> HON-225 and HON-225 -> HON-226, exactly one
  active relation each
- managed checkpoint: `77d93627-2ae0-44d0-8e85-69b82715dfee`; SHA-256
  `97e1e2d64cec44811af3fa8bf5ffffb532dcc08a458f0879231bb6b89fdad20b`
- API verification errors: 0

## Final Linear Readback

- synchronized at `2026-07-22T11:41:53+09:00`
- HON-224: Done and archived at `2026-07-21T09:22:10.453Z`
- HON-225: Done and archived at `2026-07-21T22:53:21.567Z`
- HON-226: Done and archived at `2026-07-22T02:39:04.165Z`
- HON-221: Done and archived at `2026-07-22T02:41:53.724Z`
- parent relation: all three remain direct children of HON-221
- serialization remains HON-224 -> HON-225 -> HON-226
