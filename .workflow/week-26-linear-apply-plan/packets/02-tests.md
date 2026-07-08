Packet ID: 02-tests
Objective: Prove the apply-plan command is local-only and fails closed.
Ownership: `test/ops/linear-apply-plan.test.ts`.
Do:

- Use child-process execution like the existing preflight tests.
- Test no-report blocked output, strict failure, preflight blocked output,
  ready report classification, workspace/team mismatch, and no-network behavior.
  Do not:
- Use a local HTTP listener or real Linear credentials.
  Expected output: focused Vitest coverage.
  Verification: `pnpm exec vitest run test/ops/linear-apply-plan.test.ts`.
