Packet ID: 02-gate-tests
Objective: Make the publication runbook part of release readiness checks.
Context: Release gate already requires core release documents.
Files / sources:

- `scripts/honowarden-release-gate.mjs`
- `test/release-docs.test.ts`
- `docs/current-state.md`
  Ownership: main
  Do:
- Add `publication-gate.md` to required release docs.
- Add tests for the exact approval text and command strings.
- Record the new runbook in current-state.
  Do not:
- Weaken release gate or skip existing required docs.
  Expected output: tests fail if publication approval text or commands drift.
  Verification: `pnpm exec vitest run test/release-docs.test.ts
test/ops/release-gate.test.ts`
