# Week 26 Staging Dry Run Evidence

## Goal

Add reproducible staging deploy dry-run evidence for the alpha release gate
without mutating Cloudflare resources or claiming a live staging deployment.

## Success Criteria

- A local script runs `wrangler deploy --env staging --dry-run --outdir ...`.
- The script validates staging Worker, D1, R2, and fail-closed environment
  bindings from `wrangler.jsonc`.
- The script records bundle size and SHA-256 for the generated Worker bundle.
- Release gate staging evidence requires substantive fields, not only file
  existence.
- Backup/restore docs no longer show pnpm argument forwarding that the wrapper
  rejects.
- Local targeted tests, typecheck, lint, and format pass.

## Current Context

The release gate currently has three blockers: synthetic live-client evidence,
staging deploy evidence, and Cloudflare resource evidence. A staging dry-run can
remove only the staging evidence blocker. Cloudflare resource evidence remains
separate because D1 IDs are placeholders and no remote resources are created.

## Constraints

- Do not write the upstream provider brand string to tracked files.
- Do not deploy, create resources, set secrets, or mutate external systems in
  this slice.
- Keep generated bundle output under ignored `test/.tmp/`.
- Record limitations so dry-run evidence cannot be mistaken for a real staging
  deployment.

## Risks

- Overclaiming readiness while `database_id` values remain placeholders.
- Letting release gate pass on a shallow evidence file.
- Generated dry-run bundles being picked up by lint or format.

## Approval Required

No additional approval is required for local scripts, tests, docs, workflow
artifacts, commits, and pushes. Real Cloudflare resource mutation, secrets, or
deploys require a separate gate.

## Work Packets

- `01-dry-run-script`: Implement the staging dry-run script and package script.
- `02-gate-docs`: Tighten release gate evidence requirements and update docs.
- `03-verification`: Run local gates, brand scans, workflow verifier, push, and
  record CI.

## Integration Policy

Prefer conservative evidence. If a check proves only local bundling, call it a
dry-run and keep Cloudflare resource readiness blocked.

## Verification

- `pnpm test -- test/ops/staging-dry-run.test.ts test/ops/release-gate.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm release:gate`
- repository brand content and path scans
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

`scripts/honowarden-staging-dry-run.mjs` can be rerun before release tagging and
with `--require-clean` when recording durable evidence.
