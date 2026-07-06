# Orchestration: Week 15 Client Compatibility Matrix

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If live client evidence is unavailable, keep all rows at `fixture_only`.
- If a source URL would introduce a direct external brand string in tracked docs, record source kind and checked timestamp instead of the URL.
- If exact versions cannot be established for a required surface, fail the slice rather than using `latest` or a broad version range.

## Packet Prompts

- `01-release-metadata`
  - Objective: collect exact current versions and release timestamps for required client surfaces.
  - Files: release metadata commands only; no tracked file ownership.
  - Verification: versions are exact and source check time is recorded.
- `02-matrix-artifacts`
  - Objective: add structured and human-readable compatibility matrix artifacts.
  - Files: `compat/client-matrix.json`, `docs/compatibility-matrix.md`, Week 15 spec.
  - Verification: matrix covers browser extension, desktop, mobile Android, mobile iOS, and CLI.
- `03-matrix-validation`
  - Objective: add CI validation that prevents vague or incomplete matrix rows.
  - Files: `test/compat/client-matrix.test.ts`.
  - Verification: `pnpm compat:test`.
- `04-verification`
  - Objective: prove the integrated docs/test slice is ready to push.
  - Files: workflow files and quality command evidence.
  - Verification: full local gates, brand scan, push, and CI result.

## Completion Audit

- Confirm required surfaces and mobile build numbers are present.
- Confirm every row has non-empty known issues.
- Confirm matrix uses `fixture_only`, not live compatibility claims.
- Confirm brand scan has no direct external brand hits.
