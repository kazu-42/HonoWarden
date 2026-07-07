# Orchestration: Week 26 Session Revoke Fixture Replay

## Execution Rules

- Keep the objective to local fixture, replay, matrix, and docs evidence.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If replay returns `401 reauth_required`, inspect fake system time and token
  issued-at/expiry claims.
- If matrix tests fail, update fixture flow manifest, required flow list, and
  every matrix `coveredFlows` list together.
- If response shape differs, inspect the route contract before changing fixture
  assertions.

## Packet Prompts

### 01-fixture-replay

Objective: add `devices/revoke-all-success.json` and route replay it with
deterministic recent-auth token timing.
Ownership: `compat/fixtures/devices/revoke-all-success.json`,
`test/compat/fixture-route-replay.test.ts`, and
`test/compat/fixture-replay-support.ts` if needed.
Expected output: targeted route replay passes.

### 02-manifest-docs-evidence

Objective: update flow manifest, matrix, docs, and workflow evidence.
Ownership: `compat/fixture-flows.json`, `compat/client-matrix.json`,
`test/compat/client-matrix.test.ts`, `docs/current-state.md`,
`docs/compatibility-matrix.md`, and this workflow directory.
Expected output: local gates pass.

## Completion Audit

- Confirm revoke-all fixture exists and is route replayed.
- Confirm recent-auth timing is deterministic.
- Confirm matrix/flow manifest tests pass.
- Confirm local checks and CI pass.
