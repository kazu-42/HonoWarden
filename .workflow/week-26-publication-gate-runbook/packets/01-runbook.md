Packet ID: 01-runbook
Objective: Add the alpha publication gate runbook.
Context: The GitHub Release draft exists and is ready for explicit publication
approval.
Files / sources:

- `docs/release/publication-gate.md`
- `docs/release/index.md`
  Ownership: main
  Do:
- Document the draft state, status packet command, approval text, publication
  command, and post-publication verification.
- Link the runbook from the release index.
  Do not:
- Publish the GitHub Release.
- Claim deployment readiness.
  Expected output: operator-facing publication gate document.
  Verification: release docs tests and release gate.
