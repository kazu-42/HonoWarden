# Week 26 Password Grant Fixture Replay

## Accepted

- Added `token/password-grant-success.json` to route replay.
- Kept password-grant replay explicitly stateful with
  `allowMutatingFixtures: true`.
- Preserved the default mutating fixture guard; `folders/create-success.json`
  still fails without explicit opt-in.
- Updated current-state docs to include password-grant route replay while
  leaving refresh, TOTP, and revoke replay as remaining work.

## Rejected

- No API implementation changes were needed.
- No fixture body changes were needed; existing assertions already avoid exact
  generated token values.
- No broad weakening of `isStatelessCompatFixture` was made.
- No release, tag, deploy, DNS, email, or secret mutation was performed.

## Verification

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts` passed: 1
  file, 21 tests.
- `pnpm compat:test` passed: 3 files, 61 tests.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-password-grant-fixture-replay`
  passed.
- `pnpm check` passed.
- `pnpm lint` passed.
- `pnpm test` passed: 40 files, 345 tests.
- `pnpm format` passed.
- Repository policy external-brand scan passed with no matches.
- `pnpm release:gate -- --strict` reported `overall: ready`.
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
  reported `phase: draft_ready_for_publication`.

## Remaining Risks

- Release publication is still intentionally approval-gated.
- Refresh, TOTP, revoke, and ordered mutation fixture route replay remain future
  work.
