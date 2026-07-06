# Week 25 Feature Freeze

## Goal

Create feature-freeze release materials for `v0.1.0-alpha`.

## Success Criteria

- Fresh deploy, upgrade, rollback, migration freeze, feature-freeze checklist,
  and alpha release notes exist under `docs/release/`.
- Release docs are linked from README.
- Migration freeze hashes are checked in CI.
- Docs preserve pre-alpha, no-real-secrets, and no-independent-audit warnings.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

Week 24 added security review materials. Week 25 prepares release operations and
freeze evidence before the alpha tag week.

## Constraints

- Do not deploy or mutate Cloudflare resources in this local slice.
- Do not tag a release yet.
- Do not edit frozen migrations.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- Migration hashes can drift if not tested.
- Rollback docs can be dangerous if they imply in-place schema rollback.
- Release notes can overstate compatibility without live evidence.

## Approval Required

No approval is required for local docs, tests, git push, and CI. Tagging,
deploying, or mutating Cloudflare resources requires a separate gate.

## Work Packets

- `01-release-docs`: Add release readiness index, fresh deploy, upgrade,
  rollback, feature freeze checklist, migration freeze, and alpha notes.
- `02-release-doc-tests`: Add CI checks for required docs and migration hashes.
- `03-verification`: Run local gates, brand scans, workflow verifier, and CI.

## Integration Policy

Document process and gates without claiming release completion. Keep production
deployment and tagging for Week 26.

## Verification

- `pnpm test -- test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
