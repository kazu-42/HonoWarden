Result: completed

Verification passed:

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
- ready fixture apply-plan to mutation-packet smoke:
  55 total operations, 31 mutation steps, 21 confirmations, 3 manual
  confirmations, 0 unsupported/malformed entries
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-mutation-packet`
- `git diff --check`
- target-file secret pattern scan
- `codex review --uncommitted`

Local review follow-up:

- `codex review --uncommitted` flagged that mutation packet operations dropped
  `seedKey` metadata from ready apply-plan operations.
- The packet now preserves `seedKey`, and the mutation-packet test asserts it
  for issue mutation and confirmation entries.
- The rerun flagged unsupported ready-plan actions being silently omitted.
- The packet now blocks unsupported actions, reports them in
  `unsupportedOperations`, and strict mode exits non-zero.
- The final rerun flagged malformed ready plans without an `operations` array
  being accepted as empty ready packets.
- The packet now blocks missing/non-array operations input before strict mode can
  pass.
- The next rerun flagged supported operations with missing `id` or `kind` being
  accepted.
- The packet now reports `malformedOperations` and blocks ready inputs missing
  required operation shape: `id`, `kind`, `dependencies`, or `fields`.
- The final review flagged executable payloads such as issues with empty fields
  being accepted.
- The packet now validates per-kind minimum payload fields before strict mode can
  pass.
- The final review rerun reported no discrete correctness issues.

Remaining:

- PR, CI, merge, and handoff update
