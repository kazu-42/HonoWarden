Packet ID: 01-script
Objective: Add the read-only alpha completion audit command.
Context: Existing release gate and status packet already define readiness.
Files / sources:

- `scripts/honowarden-alpha-completion-audit.mjs`
- `package.json`
  Ownership: main
  Do:
- Aggregate strict release gate and release status packet output.
- Report complete only for published verified prerelease state.
- Fail `--strict` unless completion is complete.
  Do not:
- Publish, deploy, mutate tags, or call write APIs.
  Expected output: `pnpm release:completion:audit`.
  Verification: focused tests and current live non-strict audit.
