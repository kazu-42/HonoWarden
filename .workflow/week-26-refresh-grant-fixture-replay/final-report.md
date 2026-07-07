# Week 26 Refresh Grant Fixture Replay

## Accepted

- Added `refreshSession` and `refreshRotationChanges` to compatibility fixture
  replay database seed options.
- Added deterministic refresh-session seed data for route replay.
- Added `token/refresh-grant-success.json` to route replay with explicit
  `allowMutatingFixtures: true`.
- Reused existing `FakeD1Database` refresh-session and rotation support without
  changing production code.
- Updated current-state docs to include refresh-grant route replay while
  leaving TOTP and revoke replay as remaining work.

## Rejected

- No fixture body changes were needed; existing assertions already avoid exact
  generated token values.
- No broad weakening of `isStatelessCompatFixture` was made.
- No release, tag, deploy, DNS, email, or secret mutation was performed.

## Verification

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts` passed: 1
  file, 22 tests.
- `pnpm compat:test` passed: 3 files, 62 tests.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-refresh-grant-fixture-replay`
  passed.
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm test` passed: 40 files, 346 tests.
- `pnpm format` passed.
- Repository policy external-brand scan passed with no matches.
- `pnpm release:gate -- --strict` reported `overall: ready`.
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  reported `phase: draft_ready_for_publication`.

## Remaining Risks

- Release publication is still intentionally approval-gated.
- TOTP, revoke, and ordered mutation fixture route replay remain future work.
