# Week 26 Fixture Route Replay

## Goal

Add a route-executed compatibility fixture replay layer for the safest
implemented fixture subset, so fixtures prove real Hono behavior instead of
only static JSON shape.

## Success Criteria

- Replay deterministic read-only/stateless fixtures against `src/app.ts`.
- Use the same fixture assertion semantics as the static fixture validator.
- Seed `FakeD1Database` with synthetic, non-secret user/folder/cipher rows where
  a read route needs state.
- Keep mutating fixture replay out of this slice until flow state sequencing is
  explicit.
- Update current-state and compatibility docs with the new replay coverage and
  remaining non-goals.
- Local verification passes for targeted compat tests, workflow artifact,
  typecheck, lint, full test suite, format, release status packet, release gate,
  and repository brand scan.

## Current Context

- `compat/fixtures/**/*.json` already records client-facing request/response
  shapes and assertions.
- `test/compat/compat-fixtures.test.ts` validates fixture structure and
  assertion paths against fixture response bodies.
- Route behavior is covered by HTTP tests, but fixtures are not yet replayed
  against the app.
- `docs/current-state.md` still lists route-executed fixture replay as not
  implemented.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not replay mutating fixtures in this slice.
- Keep replay fixtures synthetic and non-secret.

## Risks

- Replaying every fixture at once would require stateful sequencing and could
  hide false positives behind broad fake database behavior. Mitigation: start
  with deterministic stateless/read-only fixtures and document the boundary.
- Fixture equality can be too strict for dynamic response fields such as request
  IDs and timestamps. Mitigation: validate status and fixture assertions against
  route responses rather than requiring entire-body equality for every replayed
  fixture.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-replay-helper`: Add fixture loading, route execution, and assertion helper
  for deterministic fixture replay.
- `02-replay-tests-docs`: Add replay test coverage and update current-state /
  compatibility documentation.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only deterministic read-only/stateless replay in this workflow. Reject
mutation flow replay, live client promotion, and changes to fixture semantics
that weaken existing static validation.

## Verification

- `pnpm exec vitest run test/compat/compat-fixtures.test.ts test/compat/fixture-route-replay.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

The route replay helper should become the entrypoint for adding stateful
mutation fixture replay in later slices.
