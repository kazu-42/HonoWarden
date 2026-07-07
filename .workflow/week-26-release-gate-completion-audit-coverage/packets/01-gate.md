Packet ID: 01-gate
Objective: Require completion audit workflow evidence in release gate.
Context: The alpha completion audit workflow was added and CI passed in run
`28867303505`.
Files / sources:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`
  Ownership: main
  Do:
- Add `week-26-alpha-completion-audit` to required workflow slugs.
- Assert the workflow evidence path in release gate tests.
  Do not:
- Treat current alpha state as complete.
- Publish or deploy.
  Expected output: release gate workflow evidence includes the completion audit
  state file.
  Verification: `pnpm exec vitest run test/ops/release-gate.test.ts`
