# Orchestration: Week 26 Refresh Grant Fixture Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If refresh replay fails due to token string mismatch, keep fixture assertions
  shape-based and do not assert exact generated token values.
- If replay fails due to missing FakeD1 behavior, inspect app tests before
  extending FakeD1.
- If default mutating fixture protection weakens, stop and revise.

## Packet Prompts

### 01-seed-type

Objective: add `refreshSession` to the fixture replay database seed type.
Ownership: `test/compat/fixture-replay-support.ts`.
Expected output: TypeScript can pass refresh session seed through to FakeD1.

### 02-route-replay

Objective: add `token/refresh-grant-success.json` to route replay with
`allowMutatingFixtures: true` and a deterministic `refreshSession` seed.
Ownership: `test/compat/fixture-route-replay.test.ts`.
Expected output: targeted route replay passes.

### 03-docs-evidence

Objective: update current-state docs and workflow evidence.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm refresh-grant fixture is route replayed.
- Confirm default mutating fixture guard still rejects `folders/create`.
- Confirm targeted compat tests pass.
- Confirm broad local checks and CI pass.
