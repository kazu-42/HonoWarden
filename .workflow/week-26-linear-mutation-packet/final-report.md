# Week 26 Linear mutation packet final report

## Status

Implemented and locally verified.

## Accepted

- Spark implemented the bounded script/test slice in its assigned files.
- Main integration tightened fail-closed behavior so blocked input plans produce
  no mutation steps or confirmations.
- Main integration preserved apply-plan `seedKey` metadata in packet operations
  after local review flagged the omission.
- Main integration blocks unsupported ready-plan operation actions so strict
  packets cannot silently omit work.
- Main integration blocks malformed ready plans that omit the operations array.
- Main integration blocks supported-action operations missing required operation
  shape: `id`, `kind`, `dependencies`, or `fields`.
- Main integration validates per-kind minimum payload fields for executable
  packet entries.
- `pnpm linear:mutation-packet` reads a ready apply-plan JSON and emits a
  local-only handoff packet for a future guarded writer.
- The packet separates mutation candidates, existing-object confirmations, and
  manual confirmations.
- The command does not read credentials, call network APIs, resolve Linear IDs,
  or execute writes.
- Operator docs describe the preflight, apply-plan, mutation-packet sequence and
  keep execution evidence separate from planning artifacts.

## Verification

Passed:

- `pnpm exec vitest run test/ops/linear-mutation-packet.test.ts`
- `pnpm exec vitest run test/ops/linear-apply-plan.test.ts test/ops/linear-mutation-packet.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `pnpm linear:seed`
- `pnpm linear:preflight`
- `pnpm linear:apply-plan`
- `pnpm linear:mutation-packet -- --apply-plan /tmp/honowarden-blocked-apply-plan.json`
- ready fixture:
  `pnpm linear:apply-plan -- --preflight-report <ready-preflight.json> --strict`
  then
  `pnpm linear:mutation-packet -- --apply-plan <ready-apply-plan.json> --strict`
  produced 55 total operations, 31 mutation steps, 21 confirmations, 3 manual
  confirmations, and 0 unsupported/malformed entries.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-mutation-packet`
- `git diff --check`
- target-file secret pattern scan
- `codex review --uncommitted` identified one `seedKey` preservation issue; the
  issue was fixed and covered by targeted assertions.
- The review rerun identified unsupported action omission; the issue was fixed
  and covered by targeted assertions.
- The final review rerun identified missing operations-array acceptance; the
  issue was fixed and covered by targeted assertions.
- The next review rerun identified malformed operation-shape acceptance; the
  issue was fixed and covered by targeted assertions.
- The final review identified missing per-kind payload validation; the issue was
  fixed and covered by targeted assertions.
- The final `codex review --uncommitted` rerun reported no discrete
  correctness issues.

## Remaining Risks

- `LINEAR_API_KEY` is still missing locally, so strict preflight cannot yet
  produce a ready report.
- The packet intentionally does not perform live writes.
- Future execution still needs Linear ID lookup, idempotent mutation logic, live
  readback, and write-scope evidence.
