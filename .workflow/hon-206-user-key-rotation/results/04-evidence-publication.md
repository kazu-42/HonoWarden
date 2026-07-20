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

The second standard review of commit `82328c2` returned two P1 and two P2
findings. Red tests reproduced cross-swapped account wrappers, old ciphertext
moved across vault/device slots, an oversized raw JSON body hidden by compact
re-serialization, and a canonical `person@localhost` account salt rejected by
the rotation-only regex. The remediation now rejects any overlap between the
complete old snapshot and unique next ciphertext generation, applies the 2 MB
limit while reading declared-length or chunked request bodies, and reuses the
canonical account email rule. A new exact-head review remains pending.

During the second remediation, formatting first failed with `ENOSPC`. The
source tree remained intact; a stale completed HON-204 Wrangler/workerd process
group and 4.6 GiB of ignored root `test/.tmp` state were removed, available
space recovered from 1.8 GiB to 6.1 GiB, and all source-integrity gates below
were rerun. Dirty historical worktrees were preserved.

## Independent five-axis review

An exact-head `codex review --base main` attempt at `3b28d4c` stopped before
source analysis because the Codex account had reached its usage limit. This is
recorded as unavailable, not as a pass. A separate read-only Opus review then
examined the complete exact-head diff across intent/contract fidelity,
correctness/security, architecture/D1 integrity, repository consistency, and
regression/operations/test evidence. Its overall result was MERGE READY with
zero P1, zero P2, and two P3 findings:

- The pinned web-client provenance accidentally contained a 41-character hash.
  The official `web-v2026.6.1` tag resolves to the 40-character commit
  `39f07436ca60e3f25eac47777671754f288a98f1`; fixture, lifecycle report,
  evidence, and regression assertions now use that exact value.
- Durable notification socket cleanup is scheduled after the D1 transaction
  instead of delaying the 200 response. This is intentional and matches the
  KDF-change contract: D1 has already revoked every authorization path
  atomically, while a prompt acknowledgement lets the client persist the
  matching local password/user-key generation. The best-effort transport
  cleanup is forward-only, uses `waitUntil`, and logs failures. The rationale is
  now explicit in code and the security data-flow documentation.

The reviewer also called out future evidence improvements rather than merge
blockers: apply production migrations directly in the real-D1 integration
fixture, and reduce reliance on hand-written D1 fakes and lifecycle
self-reporting. A final read-only exact-head review and all verification gates
will be rerun after these P3 changes before merge.

## Verification

- Route lifecycle acceptance: 1 file / 2 tests passed.
- Focused domain/repository/real-D1/route/config/policy/lifecycle: 8 files / 82
  tests passed.
- Full suite: 96 files / 1,167 tests passed.
- Compatibility: 3 files / 105 tests passed.
- `pnpm check`, full `pnpm lint`, full `pnpm format`, and `git diff --check`
  passed.
- `pnpm audit --audit-level high`: no known vulnerabilities.
- Strict release gate: ready, 11 pass / 0 manual / 0 block.
- Linear live readback before this packet: HON-217 Done, HON-218 In Progress,
  three expected block relations, zero unexpected relations.

## Publication boundary

Exact-head reviews and GitHub/Linear closeout are deliberately not claimed by
this pre-review checkpoint. Source merge does not activate the false flag,
mutate remote D1/R2, rotate a real account or secret, or promote official-client
compatibility. Recovery after a committed generation remains forward-only.
