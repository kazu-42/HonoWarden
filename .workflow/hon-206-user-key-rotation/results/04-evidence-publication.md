# Packet 04 result: lifecycle evidence and publication checkpoint

## Status

Local implementation and evidence are complete. The packet remains In Progress
for exact-head standard/five-axis reviews, PR/head CI, merge-tree equality,
merged-main CI, Linear Done/archive, HON-207 advancement, and isolated worktree
cleanup. No tracked environment is enabled.

## Actual local lifecycle

- `pnpm account:key-rotation:lifecycle` starts actual local Wrangler Workers
  over all migrated D1 state and a local R2 sentinel. The JSON report has nine
  passing checks and contains only statuses, counts, check IDs, and one R2
  digest.
- The populated primary account commits one password/user/private-key, personal
  folder/cipher/attachment-metadata, trusted-device, security-stamp/revision,
  session, auth-request, and required-audit generation.
- Old access, refresh, and password credentials fail. After persisted Worker
  restart, a new password grant and profile/sync/backup readers project one
  complete generation, and attachment download returns the unchanged bytes.
- An account-scoped final-audit trigger returns 503 while D1 readback proves the
  account, vault, device, refresh session, and audit count all rolled back.
- Concurrent first/second generation requests return one 200 and one safe 401
  after the winning security stamp commits. Exact real-D1 repository coverage
  separately proves one transaction result `rotated` plus one `conflict` when
  both calls enter the CAS.
- HTTP reads and three direct local-R2 reads preserve the seeded object path and
  bytes. The report records only SHA-256
  `8dd266f710ea4fd2862394455c5818d99b42f28a8fe9045617b09177d365283c`.
- A disabled Worker with global quota enabled returns 501 and leaves complete
  D1 readback byte-equivalent.

## Cleanup remediation

The first successful runner attempt exposed an operational harness defect:
signalling the `pnpm` wrapper left descendant Wrangler/workerd processes holding
stdout pipes. The runner now launches each Worker in a dedicated process group,
signals the group, waits for disappearance, escalates to group SIGKILL only
after a deadline, closes pipes, and fails if any member remains. The initial
run's own process group was removed, and two subsequent lifecycle executions
completed with exit 0 and zero matching descendants.

## Standard review remediation

The first standard review of commit `34087c0` returned four P1 findings and one
P2 finding. Each finding was reproduced as a failing repository, domain, or
real-D1 test before source changes:

- raw JSON inequality allowed a cipher to retain one old-generation encrypted
  value
- attachment staleness compared an internal attachment revision instead of the
  parent cipher revision exposed by sync
- UUID-only device parsing rejected HonoWarden's composite device IDs and did
  not resolve the client identifier to its owner-scoped stored ID
- already-revoked devices retained old wrapped keys that password login could
  reactivate
- legacy stored cipher JSON without `favorite` did not receive the same false
  default as cipher creation

The repository now compares every supported key-dependent cipher value,
resolves unambiguous device ID/identifier references, uses the parent cipher
revision for client staleness, defaults an absent stored `favorite` to false,
and clears old keys from already-revoked devices in the same batch. Revoked
key-bearing rows are part of the exact current device manifest, so a snapshot
race loses the user CAS before any write instead of committing and then
surfacing a false infrastructure failure from a post-commit count mismatch.
Exact-head standard and five-axis reviews remain pending.

## Verification

- Route lifecycle acceptance: 1 file / 2 tests passed.
- Focused domain/repository/real-D1/route/config/policy/lifecycle: 7 files / 74
  tests passed.
- Full suite: 95 files / 1,159 tests passed.
- Compatibility: 3 files / 105 tests passed.
- `pnpm check`, full `pnpm lint`, full `pnpm format`, and `git diff --check`
  passed.
- `pnpm audit --audit-level low`: no known vulnerabilities.
- Strict release gate: ready, 11 pass / 0 manual / 0 block.
- Linear live readback before this packet: HON-217 Done, HON-218 In Progress,
  three expected block relations, zero unexpected relations.

## Publication boundary

Exact-head reviews and GitHub/Linear closeout are deliberately not claimed by
this pre-review checkpoint. Source merge does not activate the false flag,
mutate remote D1/R2, rotate a real account or secret, or promote official-client
compatibility. Recovery after a committed generation remains forward-only.
