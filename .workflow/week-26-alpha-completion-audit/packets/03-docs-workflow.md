Packet ID: 03-docs-workflow
Objective: Document completion audit usage and record state.
Context: Publication gate runbook is the operator-facing release publication
document.
Files / sources:

- `docs/release/publication-gate.md`
- `docs/current-state.md`
- `.workflow/week-26-alpha-completion-audit/*`
  Ownership: main
  Do:
- Add pre-publication and post-publication audit commands to publication gate.
- Record the current incomplete blocking reason.
- Fill workflow artifact with scope and risks.
  Do not:
- Claim publication or deployment happened.
  Expected output: docs explain strict audit behavior.
  Verification: release docs tests.
