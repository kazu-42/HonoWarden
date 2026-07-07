# Orchestration: Week 26 Release Gate Publication Runbook Coverage

Goal:
Require the completed publication gate runbook workflow in alpha release gate
evidence.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the publication runbook workflow state is not completed, fix that state
  before requiring it in release gate.
- If release gate fails, inspect failed workflow evidence rather than weakening
  the gate.
- If the GitHub Release is no longer a draft, stop and switch to
  post-publication verification instead of publishing.

## Packet Prompts

- `01-gate`: update release gate required workflow slugs and tests.
- `02-state-docs`: add CI evidence and current-state notes.
- `03-verification`: run checks, push, watch CI, and read release state.

## Completion Audit

- Release gate output includes
  `.workflow/week-26-publication-gate-runbook/state.json`.
- Release gate remains `overall: "ready"`.
- Release status packet remains `phase: "draft_ready_for_publication"`.
- GitHub Release remains a draft prerelease until explicit approval is given.
