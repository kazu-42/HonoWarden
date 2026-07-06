# Packet 02: Tests And Docs

## Objective

Make the preflight behavior reviewable and documented.

## Scope

- `test/ops/release-gate.test.ts`
- `test/release-docs.test.ts`
- `docs/release/release-gate-preflight.md`
- `docs/release/index.md`
- `docs/current-state.md`

## Tasks

- Test current `not_ready` behavior.
- Test strict mode failure while blockers remain.
- Add release docs explaining what the preflight proves and does not prove.
- Include the preflight doc in release docs presence checks.

## Acceptance

- Tests fail if the current blocker set is accidentally treated as ready.
- Docs clearly state that external evidence remains required.
