# Week 26 Release Gate Preflight

## Goal

Add a read-only release gate preflight so `v0.1.0-alpha` readiness can be
checked from repository evidence before any tag or deployment.

## Success Criteria

- `pnpm release:gate` prints a structured JSON report.
- The report distinguishes passed repository-local evidence from release
  blockers.
- Strict mode exits non-zero while blockers remain.
- Release docs explain how to use the preflight.
- CI runs the non-strict release gate preflight.
- Tests cover current `not_ready` behavior.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

Week 25 created release materials. Week 26 still needs live operational evidence
before tagging. Current known blockers are live-client evidence, backup/restore
drill evidence, staging deploy evidence, and Cloudflare resource evidence.

## Constraints

- Do not tag a release.
- Do not deploy or mutate Cloudflare resources.
- Do not create or update Linear resources.
- Do not contact external client services from the preflight.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- A release checker can create false confidence if it treats missing external
  evidence as pass.
- A strict gate can become unusable if it depends on live services.
- Output must remain deterministic enough for tests while still useful to
  operators.

## Approval Required

No approval is required for local scripts, docs, tests, git push, and CI.
Tagging, deploying, or mutating external systems requires a separate gate.

## Work Packets

- `01-preflight-script`: Add the read-only release gate script and package
  script.
- `02-tests-docs`: Add tests and release documentation.
- `03-verification`: Run local gates, brand scans, workflow verifier, and CI.

## Integration Policy

The preflight must report `not_ready` while alpha blockers remain. Passing local
repository checks must not be represented as release completion.

## Verification

- `pnpm release:gate`
- `pnpm test -- test/ops/release-gate.test.ts test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
