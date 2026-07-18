# Orchestration: HON-160 Account Credential Mutation

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Keep HON-160 open until every required child is merged, evidenced, and closed.
- Use one managed Linear checkpoint per issue; update rather than duplicate it.
- Do not implement a dependent child from an unmerged local-only base.

## Branching Rules

- If official client and server request shapes disagree, pin the client version
  used for live evidence and accept only server variants required by that pin.
- If a mutation cannot atomically update credential state, security stamp,
  sessions, and required audit evidence, fail loudly before returning success.
- If a child needs a migration after HON-161's unmerged `0015`, stop that child
  at design/TDD until publication order gives it an unambiguous migration ID.
- If a payload includes unsupported Send, Emergency Access, organization
  recovery, WebAuthn, or TDE rotation data, reject the complete request before
  any supported personal-vault write.
- If review finds a cross-slice invariant, repair the owning earliest child and
  propagate the contract forward before continuing.

## Packet Prompts

- P1 official contract: inspect only pinned public upstream source. Report
  routes, request variants, validation, state transitions, logout behavior, and
  explicit upstream assumptions. No edits outside `results/`.
- P2 current boundary: inspect HonoWarden schema/domain/repositories/routes/tests.
  Report reusable primitives, missing invariants, and exact edit points. No
  product edits.
- P3 test/rollback: produce a threat-oriented matrix for malformed, stale,
  concurrent, partial-failure, old-token, old-password, and unsupported-payload
  cases plus real D1 evidence. No product edits.
- P4 Linear: build a deterministic six-child manifest and relation graph. Apply
  only through root direnv and require independent readback before success.
- P5 implementation: root owns product/test edits for AUTH-2A using focused TDD.
- P6 review: independent reviewer receives the final diff, parent/child
  acceptance, test evidence, and prohibited claim boundary.

## Completion Audit

- Every parent requirement maps to one child or a named external owner.
- No child is broader than one reviewable PR and each has rollback/evidence.
- Parent/child/project/state/priority/archive and every directed `blocks`
  relation read back exactly from Linear.
- Authentication and unlock data cannot disagree on salt or KDF generation.
- Security-stamp rotation invalidates access tokens and all active refresh
  sessions without exposing raw tokens or hashes.
- D1 failure cannot leave a rotated credential, stale revision, or false success
  audit; concurrent stale writes have zero mutation effect.
- Full host verification and a fresh clean independent review are recorded.
- No commit, push, PR, merge, deploy, production mutation, or compatibility
  promotion is claimed without its own gate and readback.
