# Week 26 Cloudflare Resource Evidence

## Goal

Record Cloudflare D1/R2 resource evidence for the alpha release gate without
claiming Worker deploy, secret writes, route writes, or live HTTP smoke.

## Success Criteria

- gHive Cloudflare account identity is recorded without secrets.
- Staging and production D1 databases exist and their IDs are committed to
  `wrangler.jsonc`.
- Staging and production R2 buckets exist.
- Remote staging D1 migrations are applied and verified through `0003`.
- Release gate validates required Cloudflare resource evidence fields and
  non-placeholder D1 IDs.
- Local gates, brand scans, workflow verification, and CI pass.

## Current Context

Before this slice, release gate blockers were live-client evidence and
Cloudflare resource evidence. Staging dry-run evidence existed, but D1 IDs were
still placeholders and no remote resources had been created.

## Constraints

- Do not write the direct upstream provider brand string to tracked files.
- Do not write secrets.
- Do not deploy the Worker or attach routes in this slice.
- Do not migrate production D1 before a live deployment decision.
- Keep rollback notes explicit because Cloudflare resources were created.

## Risks

- Accidentally claiming a live deployment when only D1/R2 resources exist.
- Applying migrations locally instead of remotely.
- Committing placeholder D1 IDs after resource creation.
- Leaving release gate workflow evidence stale.

## Approval Required

The user already authorized continuing the goal and using the gHive Cloudflare
account when needed. This slice creates empty D1/R2 resources and applies
staging remote migrations. Worker deploy, route writes, secret writes, and
production data remain out of scope.

## Work Packets

- `01-resource-create`: Create/verify D1 and R2 resources and update
  `wrangler.jsonc`.
- `02-staging-migrations`: Apply and verify remote staging D1 migrations.
- `03-gate-docs`: Add release evidence, release gate validation, and docs.
- `04-verification`: Run local gates, brand scans, workflow verifier, push, and
  record CI.

## Integration Policy

Accept only evidence that distinguishes resource creation from Worker deploy.
If a command was accidentally local-only, document it and do not use it as
remote evidence.

## Verification

- `pnpm wrangler whoami`
- `pnpm wrangler d1 list`
- `pnpm wrangler r2 bucket list`
- `pnpm wrangler d1 execute ... --remote`
- `pnpm release:gate`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scans
- workflow verifier
- GitHub Actions CI

## Reusable Artifacts

`docs/release/cloudflare-resource-evidence.md` records the resource inventory
and rollback notes for alpha operations.
