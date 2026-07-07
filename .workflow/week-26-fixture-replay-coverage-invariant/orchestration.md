# Orchestration: Week 26 fixture replay coverage invariant

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If filesystem discovery reveals an existing fixture without route replay,
  add deterministic replay support or document a justified explicit exclusion.
- If route replay support needs database state, extend
  `test/compat/fixture-replay-support.ts` narrowly and add assertions.
- If release audit remains blocked only by publication approval, continue local
  implementation work and do not publish.

## Packet Prompts

### Packet 01: Route Replay Invariant

Objective: make `test/compat/fixture-route-replay.test.ts` assert complete
coverage of `compat/fixtures/**/*.json`.

Files:

- `test/compat/fixture-route-replay.test.ts`

Do:

- Discover fixture files using Node filesystem APIs.
- Compare sorted relative paths against `replayFixtures`.
- Fail on missing, unknown, or duplicate replay entries.

Do not:

- Add shell-dependent discovery.
- Add broad fixture exclusions without a documented reason.

Expected output: route replay test guards fixture coverage drift.

### Packet 02: Evidence and Docs

Objective: document the invariant and record verification.

Files:

- `docs/current-state.md`
- `.workflow/week-26-fixture-replay-coverage-invariant/**`

Do:

- Update docs to describe the complete route replay coverage invariant.
- Record verification results after checks pass.

Do not:

- Publish or mutate external release state.

Expected output: workflow state and docs explain the new guard.

## Completion Audit

- Confirm all planned checks pass.
- Confirm latest pushed commit has green CI before considering the slice done.
