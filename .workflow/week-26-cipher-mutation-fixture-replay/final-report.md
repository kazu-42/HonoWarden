# Final Report: Week 26 Cipher Mutation Fixture Replay

## Outcome

Cipher mutation and stale revision conflict compatibility fixtures are now
route-replayed against the Hono app. The work also aligned cipher trash route
semantics with the existing fixture while preserving the permanent-delete route.

## Accepted Results

- Cipher create, update, trash, restore, permanent delete, and stale revision
  conflict fixtures now run through the route replay harness.
- `DELETE /api/ciphers/:id` now trashes a cipher, matching the compatibility
  fixture.
- `DELETE /api/ciphers/:id/delete` remains the permanent-delete route.
- The legacy `PUT /api/ciphers/:id/delete` trash route remains supported.
- Narrow cipher mutation-count seed knobs are available in the route replay
  database seed.
- `docs/current-state.md` records cipher mutation and revision-conflict route
  replay coverage.

## Rejected Results

- No fixture request or response body changes were made.
- No broad route refactor was made beyond the trash/permanent-delete semantics
  fix.

## Conflicts Resolved

- The fixture expected `DELETE /api/ciphers/:id` to trash, but the app routed it
  to permanent delete. The app now treats unsuffixed `DELETE` as trash and keeps
  the suffixed `/delete` endpoint for permanent deletion.

## Verification Evidence

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts test/app.test.ts -t "cipher|compatibility fixture route replay"`
  - 2 test files passed
  - 59 tests passed
- `pnpm compat:test`
  - 3 test files passed
  - 74 tests passed
- `pnpm check`
  - passed
- `pnpm lint`
  - passed
- `pnpm test`
  - 40 test files passed
  - 358 tests passed
- `pnpm format`
  - passed
- repository policy external-brand scan
  - passed
- workflow verifier
  - passed
- `pnpm release:gate -- --strict`
  - passed with `overall: ready`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  - passed with `phase: draft_ready_for_publication`
- `pnpm release:completion:audit -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  - returned `completion: incomplete`
  - blocking reason remains `release_publication_approval_required`

## Remaining Risks

- Release publication remains externally approval-gated and was not performed.
- Live client evidence is unchanged by this local fixture replay.
- Ordered multi-step mutation replay remains future work.

## Reusable Follow-up

When route replay exposes a fixture/app mismatch, prefer fixing the app route
semantics if the fixture captures the intended client-facing behavior. Keep
legacy aliases only when they do not weaken behavior or create ambiguous
permanent-delete paths.
