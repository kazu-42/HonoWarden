# Orchestration: Week 26 Device Fixture Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If known-device scalar assertions break static validation, update both static
  and replay assertion readers consistently.
- If fixture replay requires device seed state, keep it local to
  `test/compat/fixture-route-replay.test.ts`.
- If release status remains draft-ready, report it without publishing.

## Packet Prompts

### 01 Fixtures

Own fixture JSON files under `compat/fixtures/devices/`.

Do: add deterministic success fixtures for device list, identifier lookup, and
known-device preflight.

Do not: edit manifests, tests, docs, or source code.

### 02 Tests Manifest Docs

Own `compat/fixture-flows.json`, `compat/client-matrix.json`,
`test/compat/*.ts`, `docs/current-state.md`, and
`docs/compatibility-matrix.md`.

Do: add device read and known-device flows, route replay coverage, and root path
assertion support for scalar response fixtures.

Do not: implement device mutation APIs or promote live client evidence.

### 03 Verification

Run targeted compatibility tests, broad local checks, release status checks,
push, and CI readback.

## Completion Audit

Workflow is complete only when device fixture coverage is committed, pushed,
CI passes, and the GitHub release remains unpublished unless explicit
publication approval is given.
