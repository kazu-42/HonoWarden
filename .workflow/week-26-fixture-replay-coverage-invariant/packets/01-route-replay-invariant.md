# Packet 01: Route Replay Invariant

Objective: make `test/compat/fixture-route-replay.test.ts` enforce complete
route replay coverage for every JSON fixture under `compat/fixtures`.

Context:

- Existing fixture route replay already exercises all current fixture files.
- The missing guard is future drift detection when a new fixture file is added
  without a replay entry.

Files:

- `test/compat/fixture-route-replay.test.ts`
- `compat/fixture-flows.json`

Do:

- Recursively discover fixture JSON files with Node filesystem APIs.
- Compare sorted relative paths against the replay fixture set.
- Fail on missing, unknown, or duplicate replay entries.
- Compare the replay set with the fixture-flow manifest set.

Do not:

- Use shell-dependent fixture discovery.
- Add broad exclusions without an explicit future reason.

Expected output: fixture coverage drift fails in CI before release evidence can
go stale.
