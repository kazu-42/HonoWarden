# Week 26 Account Revision Fixture Coverage

## Goal

Add explicit compatibility fixture coverage for the authenticated account
revision-date read endpoint, including route replay against the Hono app.

## Success Criteria

- A fixture documents `GET /api/accounts/revision-date` with deterministic
  response assertions.
- The fixture manifest and client coverage matrix include a dedicated
  account-revision flow.
- Route replay executes the fixture against the app with seeded user revision
  data.
- Compatibility docs and current-state docs describe the new coverage.
- Narrow compatibility checks, workflow verification, broad repo checks, and
  release gates pass.

## Current Context

- `v0.1.0-alpha` draft prerelease is ready but blocked on explicit publication
  approval.
- HEAD is past the tag target; do not move tags or publish releases in this
  workflow.
- Existing live-client evidence already exercises the revision-date endpoint,
  but the compatibility fixture matrix does not yet expose it as a reusable
  client-contract fixture.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repository-controlled
  code, docs, fixtures, or workflow artifacts.
- Keep the change small and aligned with existing fixture conventions.

## Risks

- Fixture expectations can become too weak if they only assert HTTP 200.
- A mismatched seeded `revisionDate` could make replay pass for the wrong
  reason.
- Matrix updates must stay synchronized with required-flow tests.

## Approval Required

None for local fixture/test/docs work. External release publication still
requires the exact approval text recorded by the release audit.

## Work Packets

- `01-fixture-json`: Spark worker drafts only
  `compat/fixtures/accounts/revision-date-success.json`.
- `02-integration`: main agent updates manifest, matrix, docs, route replay,
  and workflow evidence.

## Integration Policy

Accept Spark output only after local inspection. The main agent owns all
manifest/test/docs integration and verification. Do not delegate QA.

## Verification

- Targeted fixture and route replay tests.
- `pnpm compat:test`
- workflow verifier for this artifact.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- forbidden external-brand scan.
- `pnpm release:gate -- --strict`
- release status packet for the existing tag workflow run.

## Reusable Artifacts

This workflow documents the repeatable pattern for adding small read-only
compatibility fixture flows while a release publication gate is waiting.
