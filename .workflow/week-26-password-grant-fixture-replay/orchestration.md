# Orchestration: Week 26 Password Grant Fixture Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If password-grant replay fails because generated token values differ from the
  fixture body, keep assertions shape-based and do not require exact token
  strings.
- If replay fails due to missing FakeD1 behavior, inspect whether the missing DB
  operation is already covered by app tests before extending FakeD1.
- If adding password-grant replay weakens the default mutating fixture guard,
  stop and revise the design.

## Packet Prompts

### 01-route-replay

Objective: add `token/password-grant-success.json` to route replay with
`allowMutatingFixtures: true`.
Ownership: `test/compat/fixture-route-replay.test.ts`.
Expected output: targeted route replay passing.

### 02-docs-evidence

Objective: update docs and workflow evidence after verification.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm password-grant fixture is route replayed.
- Confirm default mutating fixture guard still rejects `folders/create`.
- Confirm targeted compat tests pass.
- Confirm broad local checks and CI pass.
