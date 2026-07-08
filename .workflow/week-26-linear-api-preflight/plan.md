# Week 26 Linear API Preflight

## Goal

Add a read-only Linear API preflight that proves a local `LINEAR_API_KEY`
targets the intended `honowarden` workspace before any future seed application
can write projects, issues, documents, views, or Pulse updates.

## Success Criteria

- The preflight fails closed when `LINEAR_API_KEY` is missing.
- The preflight calls Linear GraphQL read-only and does not mutate external
  state.
- The report does not print the API key.
- The report blocks on workspace `urlKey`, team, or required workflow state type
  mismatch, including state types referenced by seeded view filters.
- Docs explain the difference between local seed validation and live Linear API
  preflight.
- Tests cover missing key, malformed API key rejection, custom endpoint
  rejection, alternate endpoint ports, workspace environment mismatch, malformed
  seed workspace, malformed seed team, GraphQL auth failure, workspace mismatch,
  team mismatch, view status type mismatch, ready readback, strict mode, and
  secret redaction.

## Current Context

- PR #12 merged the current post-publication Linear seed.
- The available Linear MCP readback still returns an `interx` workspace.
- `LINEAR_API_KEY` is not currently configured through direnv.
- External Linear writes must remain blocked until readback proves the
  `honowarden` workspace.

## Constraints

- Do not create, update, or delete Linear objects in this slice.
- Do not print API keys or private mailbox destinations.
- Keep the preflight usable without adding runtime dependencies.

## Risks

- Linear GraphQL can return HTTP 200 with `errors`; treat that as not ready.
- A malformed API key can be reflected by lower-level header errors; reject it
  before fetch.
- A seed without `workspaceSlug` must not silently fall back to the production
  slug.
- A valid key for another workspace is more dangerous than no key; block it.
- A custom endpoint can exfiltrate the API key; reject it before network access.
- A local workspace slug override can weaken the guard; require it to match the
  seed instead of trusting it.
- Seeded views can reference workflow state types that no issue currently uses;
  include those in readiness.
- Seed validation alone is insufficient evidence for live workspace safety.

## Approval Required

No approval required for local code edits and read-only preflight checks.
Approval remains required before live Linear mutations.

## Work Packets

- `01-script`: implement read-only API preflight and package script.
- `02-tests-docs`: cover failure/ready paths and update operator docs.

## Integration Policy

Integrate only local files. Do not use `mcp__linear.save_*` or any mutation
endpoint during this workflow.

## Verification

- `pnpm linear:preflight`
- `pnpm exec vitest run test/ops/linear-preflight.test.ts`
- `pnpm linear:seed`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- workflow verifier

## Reusable Artifacts

The `linear:preflight` command becomes the reusable guard for any future Linear
seed importer or manual apply run.
