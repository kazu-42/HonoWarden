# Orchestration: HON-206 atomic user-key rotation

## Execution Rules

- Keep HON-206 as the active objective until source, GitHub, Linear, and local
  cleanup are all complete.
- Use focused TDD for each packet and keep packet result notes isolated before
  integration.
- Treat pinned public upstream source, explicit Linear acceptance criteria,
  local invariants, and real D1 evidence as the authority order.
- Work only in `feat/hon-206-user-key-rotation`; accommodate but never revert
  unrelated user changes.
- Do not activate or deploy the route, mutate a remote database, rotate a real
  credential, or publish a compatibility claim.
- If a review finds P1/P2/P3, reproduce it as a focused test, remediate it, and
  rerun every affected exact-head gate.

## Branching Rules

- If any unsupported product field is non-empty, return 400 before proof or D1
  side effects where possible.
- If the current password proof fails, use the existing generic/rate-limited
  credential response and mutate no account or vault state.
- If account keys are missing/partial, public key changes, or V2 fields are
  populated, reject before mutation.
- If the client manifest is duplicate, foreign, incomplete, metadata-changing,
  observably stale, deleted, or includes a pending attachment, reject it.
- If the request exceeds the D1 statement budget, reject before `batch()`; never
  split one credential generation across transactions.
- If the guarded user update loses a race, every downstream statement must
  change zero rows and the route returns 409.
- If any batch statement throws, require D1 rollback and return typed 503 with a
  bounded reason; never emit a success audit/log.
- If D1 commits, acknowledge it before best-effort Durable Object cleanup so the
  official client can complete its local logout/key transition.
- If a post-commit invariant cannot be proven, report it loudly as an incident;
  do not attempt an old-generation rollback.

## Packet 01: Contract and domain

Objective: pin the exact V1 request and implement a strict pure parser plus
manifest types.

Ownership: `.workflow/hon-206-user-key-rotation/`,
`src/domain/user-key-rotation.ts`, and
`test/domain/user-key-rotation.test.ts`.

Do: cover aliases, allowlists, bounds, unchanged KDF/salt metadata, V1 dual key
equality, unsupported arrays, cipher/folder/attachment/device manifests,
duplicates, immutable metadata, and revision syntax.

Do not: edit routes, repositories, configuration, or D1 behavior.

Verification: focused domain tests plus TypeScript and formatting.

## Packet 02: Atomic repository

Objective: add the bounded guarded D1 transaction and exact result model.

Ownership: `src/repositories/credential-repository.ts`, its focused tests,
`test/support/fake-d1.ts`, and the real local-D1 lifecycle harness.

Do: pre-read exact server state, build a statement-budgeted transaction, guard
the old generation and manifests, update all supported rows, revoke sessions,
supersede auth requests, insert one redacted audit, and prove rollback.

Do not: add a public route or touch R2 object bytes/keys.

Verification: repository/fake tests and real local D1 abort/concurrency checks.

## Packet 03: Route and consistency

Objective: expose the default-off authenticated route and preserve client/state
ordering.

Ownership: `src/app.ts`, `src/bindings.ts`, `wrangler.jsonc`, `.env.example`,
fixtures, route tests, and operator/security docs.

Do: authenticate, parse, apply proof defense, invoke the transaction, schedule
generation-aware notification cleanup, return exact statuses, project the new
generation consistently, and keep every environment false.

Do not: promote official-client compatibility or deploy.

Verification: focused route/compat/config tests, old-token rejection, and
post-rotation token/profile/sync/backup readback.

## Packet 04: Evidence and publication

Objective: integrate evidence, run all quality gates, review, merge, and close
the Linear hierarchy.

Ownership: lifecycle evidence, workflow result notes, release/security docs,
PR metadata, and managed Linear checkpoints.

Do: run real D1 restart/abort/concurrency/R2 sentinel evidence, standard review,
independent five-axis review, exact-head CI, admin squash merge, exact-main CI,
sub-issue and HON-206 Done/archive, HON-207 advancement, and worktree cleanup.

Do not: deploy or mutate real users.

Verification: exact readback at every external boundary.

## Integration Policy

- Accept only packet outputs that preserve the full generation invariant.
- Reject convenience fallbacks that skip unsupported arrays, exact sets,
  attachment ownership, statement budgets, or audit/session coupling.
- Resolve contract ambiguity against the pinned source and record any limit that
  the official request cannot express.
- Keep tracked docs truthful to evidence level; local fixture or D1 proof is not
  a live official-client compatibility promotion.

## Completion Audit

- Four Linear sub-issues exist under HON-206 with deterministic sequence and
  exact managed plan readback.
- All supported encrypted rows and credential/session state commit once or not
  at all under real D1.
- R2 sentinel object identity and bytes are unchanged.
- Every tracked environment keeps the route false.
- Exact candidate head has clean standard and five-axis review plus green CI.
- Squash tree equals the reviewed tree and merged-main CI is green.
- All four sub-issues and HON-206 are Done and archived with `trash:false`;
  HON-207 is the next active slice.
