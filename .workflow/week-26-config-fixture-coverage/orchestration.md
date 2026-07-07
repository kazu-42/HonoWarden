# Orchestration: Week 26 Config Fixture Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If replay origin differs from the fixture, prefer updating the fixture to the
  app replay origin. Only extend the replay helper if the route cannot be
  represented by current fixture conventions.
- If the fixture requires a full URL path, stop and inspect fixture schema tests
  before changing validators.
- If release/tag/deploy mutation becomes necessary, stop and request explicit
  approval.

## Packet Prompts

### 01-fixture-json

Objective: draft `compat/fixtures/config/server-config-success.json`.
Ownership: that fixture file only.
Expected output: direct file edit plus response-shape summary.
Do not: update manifest, tests, docs, workflow files, or run QA.

### 02-integration

Objective: wire the fixture into flow manifest, matrix, route replay, docs, and
workflow evidence.
Ownership: main agent.
Expected output: passing local verification, pushed commit, and CI evidence.

## Completion Audit

- Confirm the fixture exists and has assertions beyond HTTP status.
- Confirm `config` is listed in `compat/fixture-flows.json`.
- Confirm every client matrix row includes `config`.
- Confirm `test/compat/client-matrix.test.ts` requires `config`.
- Confirm route replay includes `config/server-config-success.json`.
- Confirm docs/current-state and docs/compatibility-matrix mention the flow.
- Confirm local checks and CI pass.
