# Orchestration: Week 26 Prelogin Fixture Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a fixture mutates state, keep it out of stateless replay.
- If a POST route is not explicitly known to be non-mutating and deterministic,
  do not add it to stateless replay.
- If release status remains draft-ready, report it without publishing.

## Packet Prompts

### 01 Stateless Classification

Own `test/compat/fixture-replay-support.ts`.

Do: allow `GET` fixtures and the two prelogin POST paths as stateless replay.

Do not: allow all POST fixtures, replay token grants, or modify production code.

### 02 Tests Docs

Own `test/compat/fixture-route-replay.test.ts`,
`docs/current-state.md`, and `docs/compatibility-matrix.md`.

Do: add `prelogin/pbkdf2.json` to route replay and clarify replay coverage.

Do not: promote live evidence or claim stateful replay is complete.

### 03 Verification

Run targeted compatibility tests, broad local checks, release status checks,
push, and CI readback.

## Completion Audit

Workflow is complete only when prelogin fixture replay is committed, pushed,
CI passes, and the GitHub release remains unpublished unless explicit
publication approval is given.
