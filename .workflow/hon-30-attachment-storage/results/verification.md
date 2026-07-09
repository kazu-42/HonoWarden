# Result: verification

Accepted.

Executed local verification:

- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts`
  passed: 3 files, 20 tests.
- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts test/app.test.ts test/compat test/release-docs.test.ts test/security-docs.test.ts`
  passed: 14 files, 385 tests.
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm format` passed after `pnpm format:write`.
- `pnpm test` passed: 93 files, 807 tests.
- `git diff --check` passed.

Workflow verification is expected to pass after these packet/result files are
committed.
