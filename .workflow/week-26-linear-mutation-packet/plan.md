# Week 26 Linear mutation packet

## Goal

Add a local-only command that converts a ready Linear apply plan into a
reviewable mutation packet for a future guarded writer.

## Success Criteria

- The command refuses to run without an apply-plan JSON file.
- The command fails closed unless the input has `schemaVersion: 1`,
  `mode: "plan"`, and `status: "ready"`.
- The command never reads credentials, calls `fetch`, or mutates Linear.
- The output separates automated mutation candidates, existing-object
  confirmations, and manual confirmations.
- Mutation candidates preserve the operation payload needed by a later writer.
- Strict mode exits non-zero when the packet is blocked.
- Tests cover blocked, ready, strict, and no-network/no-secret behavior.
- Docs and workflow artifacts make the live-write boundary explicit.

## Current Context

- PR #14 added `pnpm linear:apply-plan` and merged to `main`.
- Local strict Linear preflight is still blocked by missing `LINEAR_API_KEY`.
- A live writer is intentionally out of scope until strict preflight and
  write-scope evidence are available.

## Constraints

- Do not write to Linear.
- Do not read `LINEAR_API_KEY` or any other credential in this command.
- Do not introduce external compatibility-brand naming in identifiers.
- Keep the slice small enough to review and merge independently.

## Risks

- A packet could be misread as proof that live writes happened.
- Missing payload fields would make the next writer incomplete.
- Manual operations such as Pulse defaults and project-scoped views must remain
  explicit.

## Approval Required

- No approval required for local-only code, tests, docs, branch, PR, or merge;
  the user already authorized normal PR/merge flow.
- Approval would be required before any real Linear mutation, but that is out of
  scope for this slice.

## Work Packets

- `01-script`: implement the mutation packet CLI.
- `02-tests`: cover command behavior and safety invariants.
- `03-docs`: document the packet in current-state and operator runbooks.
- `04-integration`: run verification, review, PR, CI, merge, and handoff update.

## Integration Policy

- Accept Spark output only after local inspection.
- Do not duplicate Spark-owned edits while it is running unless it stalls.
- Main agent owns docs, workflow artifacts, final verification, PR, and merge.

## Verification

- Targeted Vitest for mutation packet and apply-plan.
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `pnpm linear:seed`
- `pnpm linear:preflight`
- `pnpm linear:apply-plan`
- `pnpm linear:mutation-packet`
- workflow verifier
- `git diff --check`
- local `codex review --uncommitted`

## Reusable Artifacts

- `.workflow/week-26-linear-mutation-packet/`
- A local command contract that can become the input to a later guarded writer.
