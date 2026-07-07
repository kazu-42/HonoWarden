# Week 26 fixture replay coverage invariant

## Goal

Make fixture route replay coverage self-checking so every JSON fixture under
`compat/fixtures` is either route-executed by `test/compat/fixture-route-replay.test.ts`
or the test suite fails.

## Success Criteria

- `test/compat/fixture-route-replay.test.ts` fails when a fixture file exists
  without a matching `replayFixtures` entry.
- The invariant also confirms replay entries point to real fixture files and do
  not duplicate paths.
- Fixture-flow manifest coverage remains aligned with the route replay set.
- Targeted compatibility tests, full tests, typecheck, lint, formatting, brand
  scan, workflow verification, and release readiness audits pass.

## Current Context

- All current `compat/fixtures/**/*.json` files are expected to have deterministic
  route replay coverage.
- The release draft for `v0.1.0-alpha` remains external-publication gated and
  must not be published in this workflow.

## Constraints

- Do not write the external compatibility brand name into repo-controlled files.
- Do not publish GitHub releases, move tags, deploy, change DNS, or mutate
  Cloudflare/email resources.
- Keep the change small and focused on regression prevention.

## Risks

- False-positive filesystem ordering or path normalization issues could make the
  test flaky across platforms.
- Overly strict coverage might block intentional future fixtures that are not
  route-executable yet; if needed, future work should add an explicit exclusion
  mechanism with a reason.

## Approval Required

- No approval required for local test/docs/workflow edits.
- Explicit operator approval is still required before release publication.

## Work Packets

1. Route replay invariant
   - Own `test/compat/fixture-route-replay.test.ts`.
   - Add deterministic fixture filesystem discovery and set comparisons.
2. Documentation and workflow evidence
   - Own `docs/current-state.md` and `.workflow/week-26-fixture-replay-coverage-invariant`.
   - Record the invariant and verification evidence.

## Integration Policy

Keep implementation in the existing Vitest suite. Prefer Node standard library
filesystem APIs and sorted relative paths over shell-dependent discovery.

## Verification

- `pnpm exec vitest run test/compat/fixture-route-replay.test.ts`
- `pnpm exec vitest run test/compat`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- brand scan with `rg`
- workflow verifier
- release gate/status/completion audit

## Reusable Artifacts

- Workflow artifact remains under `.workflow/week-26-fixture-replay-coverage-invariant`.
