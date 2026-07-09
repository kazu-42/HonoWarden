# Week 26 Linear resolution plan

## Goal

Add a local-only resolution-plan step after `linear:request-plan` that verifies
whether a future guarded writer has the Linear IDs needed to execute each
request.

The command should consume a ready request plan and an optional local resolution
map. It must never call Linear or read credentials.

## Success Criteria

- `pnpm linear:resolution-plan -- --request-plan <path>` emits JSON only.
- `--resolution-map <path>` supplies local IDs; without it the report is
  blocked with a clear missing-map reason.
- `--strict` exits non-zero when the report is not ready.
- Ready output includes resolved IDs per request step and carries confirmations
  and manual confirmations forward.
- Missing IDs are reported with enough context for an operator or later
  readback command to fill the map.
- The command reads only supplied JSON files and does not read credentials,
  call `fetch`, use GraphQL, or mutate external systems.
- Tests cover required request-plan path, missing map, ready map, missing IDs,
  blocked request plan, strict failure, and no-network/no-secret behavior.

## Current Context

- PR #16 added `linear:request-plan`, which emits local request intents and
  `requires` fields such as `teamId`, `projectId`, `labelIds`, `stateIds`, and
  `blockedByIssueIds`.
- Strict live Linear preflight remains blocked locally because
  `LINEAR_API_KEY` is not configured.
- A local resolution-plan layer can still harden the writer boundary by making
  the ID map contract explicit and testable.

## Constraints

- Do not write to Linear.
- Do not read `LINEAR_API_KEY` or any other credential.
- Do not call `fetch`, GraphQL, browser automation, MCP mutation tools, or
  external APIs.
- Do not introduce checked-in secrets or generated ready reports.
- Keep this slice small and independently mergeable.

## Risks

- If the resolution map shape is too loose, a future writer may treat missing
  references as optional.
- If the resolver guesses IDs, it will produce false execution evidence.
- If confirmations are treated as executable requests, the safety boundary is
  blurred.

## Approval Required

No external approval is required for this slice because it is local-only and
non-mutating.

## Work Packets

- `01-spark-script-test`: Spark implements the local CLI and targeted tests in
  a bounded write scope.
- `02-docs-integration`: Codex wires package docs and workflow results.
- `03-review`: Codex verifies, runs local review, publishes, merges, and updates
  handoff.

## Integration Policy

- Spark may edit only `scripts/honowarden-linear-resolution-plan.mjs` and
  `test/ops/linear-resolution-plan.test.ts`.
- Codex owns package wiring, docs, workflow artifacts, review, PR, CI, merge,
  and handoff.
- If Spark output weakens request-plan invariants, Codex tightens before PR.

## Verification

- `pnpm exec vitest run test/ops/linear-resolution-plan.test.ts`
- `pnpm exec vitest run test/ops/linear-request-plan.test.ts test/ops/linear-resolution-plan.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- local missing-map and ready-map smokes
- workflow verifier
- `git diff --check`
- target-file secret pattern scan
- `codex review --uncommitted`

## Reusable Artifacts

The resolution-map JSON shape becomes the future input contract for live
readback inventory and guarded writer execution.
