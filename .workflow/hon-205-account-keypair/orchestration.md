# Orchestration: HON-205 account keypair lifecycle

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Work only in `feat/hon-205-account-keypair`; do not touch concurrent dirty
  worktrees.
- Use focused TDD: demonstrate each missing behavior before implementation.
- Treat official pinned source, Linear acceptance criteria, and D1 readback as
  authoritative in that order; do not infer compatibility from shape alone.
- Keep production and remote Cloudflare state read-only.

## Branching Rules

- If pinned clients send only the legacy pair, reject all V2 fields rather than
  partially persisting them.
- If stored keys are both null, allow one guarded initialization.
- If stored keys exactly equal the request, return success without revision or
  audit mutation.
- If either stored half is missing or either value differs, return a generic
  conflict and do not disclose the stored value.
- If the guarded update loses a race, reread only by the authenticated user id:
  exact state is an idempotent replay; every other state is a conflict.
- If audit insert or any batch member fails, surface 503 and require D1 to roll
  back the keypair and revision.
- If a projection sees partial stored state, fail without returning either key.
- If a review finds P1/P2/P3, reopen implementation and rerun all affected
  focused, full, and exact-head gates.

## Packet Prompts

### 01 Contract and domain

Pin request/response fields from the recorded server/client SHAs. Add strict
bounded parsing and a three-state stored-key classifier. Cover aliases,
conflicts, whitespace/control characters, oversize values, partial state, V2
fields, and exact equality. Do not edit routes or D1.

### 02 Repository

Add a migration-free guarded initializer. The user update must require active
user, both key columns null, expected revision, and expected security stamp;
use `RETURNING id`. Insert one redacted audit event in the same D1 batch. Do not
rotate stamps, revoke sessions, or add a replacement method.

### 03 Routes and projections

Add exact-true default-off GET/POST routes with authenticated ownership and
generic errors. Return one official-compatible response builder and reuse the
same complete-state rule for token/profile/sync. Preserve sessions and keep V2
unsupported.

### 04 Evidence and review

Run real local D1 initialization/replay/conflict/rollback/restart checks and a
pinned synthetic client contract. Update truthful docs and rollout controls.
Run broad gates, standard review, five-axis review, PR/CI, merge/main readback,
Linear closeout, and isolated worktree cleanup.

## Completion Audit

- Every success criterion has direct test or readback evidence.
- No audit/log/evidence artifact contains opaque key values.
- Source and tracked environments keep the route default-off.
- No schema migration or production mutation occurred.
- Exact candidate head has green CI and no unresolved review thread.
- Merge commit is on `origin/main` with green main CI.
- HON-205 is Done and archived with `trash:false`; HON-206 is the next
  serialized active slice and HON-207 retains only active blockers.
