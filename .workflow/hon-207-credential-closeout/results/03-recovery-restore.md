# RECOVERY-1: Restore, Disable, And Forward Recovery

Status: RECOVERY-1A and RECOVERY-1B merged and archived; RECOVERY-1C local proof
passed and is pending exact-head review/publication

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

## Current Gate

HON-224 was merged through PR #112. HON-225 was merged through PR #113 at
`c1e2f7c8befb4c85030d48e9b7171fb5599761c2`; its squash tree matches reviewed
head `2e5a010833ddb69d4a0071de450318c78402bfe0`, main CI run 29874991552 passed,
and Linear is Done/archived. HON-226 now has a complete local same-target proof:
all four disabled writers return D1-free 501 with canonical D1/R2 identity
unchanged, one concurrent forward password generation commits, replay and all
five prior generations remain rejected, and pinned official CLI decrypt works
before and after restart. Exact-head standard/five-axis review, PR/head CI,
merge/main CI, and Linear Done/archive remain.

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

## Current Linear Readback

- synchronized at `2026-07-22T08:47:17+09:00`
- HON-224: Done and archived at `2026-07-21T09:22:10.453Z`
- HON-225: Done and archived at `2026-07-21T22:53:21.567Z`
- HON-226: In Progress and non-archived
- parent relation: all three remain direct children of HON-221
- serialization remains HON-224 -> HON-225 -> HON-226
