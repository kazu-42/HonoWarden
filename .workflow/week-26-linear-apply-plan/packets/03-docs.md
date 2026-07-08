Packet ID: 03-docs
Objective: Document the safe order from seed validation to preflight to apply plan.
Ownership: `docs/current-state.md`, `docs/operations/linear-tracking.md`,
`docs/operations/operator-environment.md`.
Do:

- Explain that apply-plan is non-mutating and does not read credentials.
- Require strict preflight readiness before future live writes.
- Keep remaining manual checks explicit for custom views and Pulse.
  Do not:
- Claim live Linear issues/projects/views have been created.
  Expected output: operator-facing docs.
  Verification: docs tests and full repo gates.
