Packet ID: 01-gate
Objective: Require publication runbook workflow evidence in release gate.
Context: The publication gate runbook was added and CI passed in run
`28866583897`.
Files / sources:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`
  Ownership: main
  Do:
- Add `week-26-publication-gate-runbook` to required workflow slugs.
- Assert the workflow evidence path in release gate tests.
  Do not:
- Change release gate semantics beyond the evidence requirement.
- Publish or deploy.
  Expected output: release gate workflow evidence includes the publication runbook
  state file.
  Verification: `pnpm exec vitest run test/ops/release-gate.test.ts`
