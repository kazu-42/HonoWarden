# Orchestration: Week 26 Fixture Route Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a fixture requires multi-step mutation state, skip it in this slice and
  list it as future stateful replay work.
- If a route response has dynamic fields, compare status and fixture assertions
  against the actual response body instead of whole-body equality.
- If helper code duplicates static fixture assertion logic, keep the duplicate
  small for now and refactor only after both static and route replay behavior
  are stable.
- If release status remains draft-ready, report it without publishing.

## Packet Prompts

### 01 Replay Helper

Own helper code under `test/compat/fixture-replay-support.ts`.

Do: load fixture JSON, generate a deterministic test request, synthesize access
tokens for `Bearer synthetic-access-token`, seed `FakeD1Database` for
implemented read-only fixture paths, run the Hono app, and validate fixture
assertions against the route response body.

Do not: replay mutating fixtures, alter production app behavior, or weaken
static fixture validation.

### 02 Replay Tests Docs

Own replay test and documentation changes under
`test/compat/fixture-route-replay.test.ts`, `docs/current-state.md`, and
`docs/compatibility-matrix.md`.

Do: enumerate the replayed fixture paths explicitly, assert replay status, and
document the current replay boundary.

Do not: promote live compatibility rows or imply all fixtures are route-replayed.

### 03 Verification

Run targeted tests first, then broad repository checks, brand scan, release gate,
release status packet, push, and CI readback.

## Completion Audit

Workflow is complete only when replay tests are committed, pushed, CI passes,
and the release draft remains unmodified unless explicit publication approval is
given.
