# Orchestration: Week 26 Release Gate Completion Audit Coverage

Goal:
Require the completed alpha completion audit workflow in release gate evidence.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the completion audit workflow state is not completed, fix that state before
  requiring it in release gate.
- If release gate fails, inspect failed workflow evidence rather than weakening
  the gate.
- If completion audit reports complete before publication, stop and inspect the
  release state because that would contradict the approval gate.

## Packet Prompts

- `01-gate`: update release gate required workflow slugs and tests.
- `02-state-docs`: add CI evidence and current-state notes.
- `03-verification`: run checks, push, watch CI, and read release/completion
  state.

## Completion Audit

- Release gate output includes
  `.workflow/week-26-alpha-completion-audit/state.json`.
- Release gate remains `overall: "ready"`.
- Completion audit remains `completion: "incomplete"` until publication and
  post-publication verification.
- GitHub Release remains a draft prerelease until explicit approval is given.
