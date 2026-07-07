# Orchestration: Week 26 Release Gate Command Scope Coverage

Goal:
Require the completed repo-scoped release command workflow as part of the alpha
release gate evidence.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the command-scope workflow lacks CI evidence, add the passed run evidence
  before requiring it.
- If release gate fails, inspect the failing workflow state instead of weakening
  the requirement.
- If Release state changes from draft to published unexpectedly, stop and read
  back the GitHub Release state before continuing.

## Packet Prompts

- `01-gate`: update release gate required workflow slugs and the release gate
  test assertion.
- `02-docs-state`: update current-state and workflow state evidence.
- `03-verification`: run checks, push, watch CI, and read back release state.

## Completion Audit

- The gate output must include
  `.workflow/week-26-release-command-repo-scope/state.json`.
- The gate must remain `overall: "ready"`.
- The GitHub Release must remain a draft prerelease until explicit publication
  approval is given.
