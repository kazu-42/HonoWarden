Packet ID: 01-gate
Objective: Require command-scope workflow evidence in the release gate.
Context: The command-scope workflow makes generated GitHub Release commands
repo-explicit with `--repo kazu-42/HonoWarden`.
Files / sources:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`
  Ownership: main
  Do:
- Add the command-scope workflow slug to required release gate evidence.
- Add a focused test assertion for the new evidence path.
  Do not:
- Change release gate semantics beyond the evidence requirement.
- Publish releases or deploy.
  Expected output: release gate report includes
  `.workflow/week-26-release-command-repo-scope/state.json`.
  Verification: `pnpm exec vitest run test/ops/release-gate.test.ts`
