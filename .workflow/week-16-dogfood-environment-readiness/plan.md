# Week 16 Dogfood Environment Readiness

## Goal

Make Week 16 dogfood safer by making staging/production separation explicit, testable, and visible in operational health responses before any real dogfood data is used.

## Success Criteria

- Runtime health responses identify the configured HonoWarden environment.
- Missing or unknown environment values fall back to `development` rather than pretending to be staging or production.
- Wrangler staging and production settings are validated in CI for distinct worker names, D1 database names, R2 bucket names, and fail-closed bootstrap defaults.
- A dogfood runbook exists for staging-first low-risk sync verification and production promotion.
- The Week 16 spec and current-state docs describe the implemented increment without claiming live dogfood success.
- Full local gates pass: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, repository brand scan, and workflow verification.

## Current Context

Week 15 added a conservative client compatibility matrix. The roadmap Week 16 acceptance criteria are broader than a single local slice because actual one-week dogfood requires deployed resources, client setup, and time. This run advances the safe prerequisite: preventing environment mix-ups and documenting a staging-first dogfood loop.

## Constraints

- Keep upstream-provider brand strings out of tracked source and docs.
- Do not create or mutate Cloudflare resources in this run.
- Do not use real secrets, real vault data, or personal dogfood entries.
- Keep Hono route handlers thin and put reusable environment logic outside `src/app.ts`.

## Risks

- A health endpoint can expose too much operational detail; only expose the coarse runtime environment.
- Config validation can be too strict while Cloudflare resource IDs are still placeholders; validate separation without requiring live resource IDs.
- Dogfood docs can sound like live evidence; clearly separate readiness from completed dogfood.

## Approval Required

No extra approval is required for local code, tests, docs, git push, and CI under the sustained repo-development request. Ask before creating Cloudflare D1/R2 resources, deploying, setting secrets, running official clients against real accounts, or storing live client evidence.

## Work Packets

- `01-runtime-environment`: add tested environment resolution and include it in health responses.
- `02-config-validation`: add CI-covered Wrangler environment separation validation.
- `03-dogfood-docs`: add Week 16 spec, dogfood runbook, and current-state update.
- `04-verification`: run full gates, brand scan, workflow verification, push, and CI.

## Integration Policy

Do not ship if production and staging config are indistinguishable, bootstrap can be enabled by default in deployable envs, health reports an unknown environment as production/staging, or docs claim dogfood has completed without live evidence.

## Verification

- Targeted failing tests before implementation.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI

## Reusable Artifacts

- `src/infra/environment.ts`
- `test/infra/environment.test.ts`
- `test/wrangler-environments.test.ts`
- `docs/dogfood-runbook.md`
- `.workflow/week-16-dogfood-environment-readiness/`
