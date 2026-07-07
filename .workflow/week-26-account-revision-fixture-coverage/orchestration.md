# Orchestration: Week 26 Account Revision Fixture Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If route replay fails because the endpoint shape differs from the fixture,
  inspect `src/app.ts` and update the fixture to describe the current API
  contract rather than weakening assertions.
- If the change requires release/tag mutation, stop and request explicit
  approval.
- If Spark output touches files outside its packet ownership, inspect and
  accept only the fixture content that fits this workflow.

## Packet Prompts

### 01-fixture-json

Objective: draft `compat/fixtures/accounts/revision-date-success.json`.
Ownership: that fixture file only.
Expected output: direct file edit plus a short summary of response fields and
assertions.
Do not: update manifest, tests, docs, or run QA.

### 02-integration

Objective: wire the fixture into the manifest, client matrix, route replay,
docs, and workflow evidence.
Ownership: main agent.
Expected output: passing local verification and pushed commit.

## Completion Audit

- Confirm the fixture exists and is referenced by `compat/fixture-flows.json`.
- Confirm every supported client matrix row includes the new required flow.
- Confirm `test/compat/client-matrix.test.ts` requires the flow.
- Confirm route replay validates the fixture against the app.
- Confirm docs/current-state and docs/compatibility-matrix mention the flow.
- Confirm all verification commands pass and release state remains
  publication-gated.
