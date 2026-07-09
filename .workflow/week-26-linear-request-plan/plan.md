# Week 26 Linear request plan

## Goal

Add a local-only request-plan step after `linear:mutation-packet` that turns a
ready mutation packet into a deterministic executor contract.

The output must be useful to a future guarded writer without performing writes:
it should enumerate mutation intents, dependencies that require Linear ID
resolution, confirmation/manual-review carryover, and unresolved execution
limits.

## Success Criteria

- `pnpm linear:request-plan -- --mutation-packet <path>` emits JSON only.
- The command requires a ready mutation packet with schema version 1.
- Blocked packets and malformed request inputs fail closed and emit no
  executable request entries.
- Ready packets produce deterministic request entries for supported local
  object kinds without reading credentials or calling network APIs.
- The output does not assert unverified live GraphQL mutation names. It uses
  stable local `intent` values and `requires` fields that a later writer can map
  after API introspection or documented confirmation.
- Tests cover ready, blocked, unsupported kind, missing mutationSteps, strict
  mode, and no-network/no-secret behavior.
- Docs explain the preflight -> apply-plan -> mutation-packet -> request-plan
  chain and that request plans are still not execution evidence.

## Current Context

- PR #15 added `linear:mutation-packet`, which separates mutation candidates,
  confirmations, and manual confirmations.
- `LINEAR_API_KEY` is not available locally, so strict live preflight and live
  writer readback remain blocked.
- A request-plan layer can still be implemented locally because it only consumes
  mutation packet JSON and seed-derived payloads.

## Constraints

- Do not write to Linear.
- Do not read `LINEAR_API_KEY` or any other credential.
- Do not call `fetch`, GraphQL, browser automation, MCP mutation tools, or
  external APIs.
- Do not introduce checked-in secrets or generated ready reports.
- Keep external compatibility-brand naming out of code identifiers and tracked
  implementation surfaces.
- Keep this slice small enough to review and merge independently.

## Risks

- Encoding real GraphQL mutation names without verified API docs or
  introspection could create a false sense of safety.
- A request-plan that drops dependencies would cause a later writer to issue
  mutations in the wrong order or with unresolved IDs.
- Treating confirmations as executable work would blur safety boundaries.

## Approval Required

No external approval is required for this slice because it is local-only and
non-mutating.

## Work Packets

- `01-spark-script-test`: Spark implements the script and targeted tests in a
  bounded write scope.
- `02-docs-integration`: Codex wires the package script and docs, then
  integrates and verifies.
- `03-review`: Codex runs local checks and `codex review --uncommitted`, fixes
  issues, and prepares PR evidence.

## Integration Policy

- Spark may edit only `scripts/honowarden-linear-request-plan.mjs` and
  `test/ops/linear-request-plan.test.ts`.
- Codex owns package wiring, docs, workflow artifacts, review, PR, CI, and
  merge.
- If Spark output conflicts with existing apply-plan or mutation-packet
  invariants, Codex updates the implementation to preserve the stricter
  invariant.

## Verification

- `pnpm exec vitest run test/ops/linear-request-plan.test.ts`
- `pnpm exec vitest run test/ops/linear-mutation-packet.test.ts test/ops/linear-request-plan.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- local blocked-packet and ready-packet smoke tests
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-request-plan`
- `git diff --check`
- target-file secret pattern scan
- `codex review --uncommitted`

## Reusable Artifacts

The request-plan JSON shape will become the input contract for a future guarded
Linear writer.
