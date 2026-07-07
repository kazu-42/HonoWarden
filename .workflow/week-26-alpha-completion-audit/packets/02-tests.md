Packet ID: 02-tests
Objective: Cover completion audit state transitions.
Context: Tests can fake `git` and `gh` while using local release gate.
Files / sources:

- `test/ops/release-completion-audit.test.ts`
  Ownership: main
  Do:
- Test draft-ready incomplete state.
- Test strict failure before publication.
- Test published verified complete state.
- Test visible release failing post-publication verification.
  Do not:
- Use real GitHub writes.
  Expected output: deterministic focused tests.
  Verification: `pnpm exec vitest run test/ops/release-completion-audit.test.ts`
