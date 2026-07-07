# Week 26 Metadata Read APIs

## Goal

Expose authenticated read-only metadata endpoints for policy and domain data
that already exists as empty metadata in the sync response.

## Success Criteria

- `GET /api/policies` returns an authenticated empty list response.
- `GET /api/policies/new` returns the same authenticated empty list response.
- `GET /api/domains` returns authenticated empty equivalent-domain metadata.
- `GET /api/settings/domains` returns the same domain metadata as an alias.
- `/api/sync` continues to use the shared domain metadata shape.
- Compatibility fixture flow `metadata_read` covers the policy and domain
  responses.
- Current-state docs record the read-only scope and remaining non-goals.
- Local verification passes for touched tests, workflow artifact, typecheck,
  lint, full test suite, format check, release gate, release status packet, and
  repository brand scan.

## Current Context

- `/api/sync` already returns `Policies`, `PoliciesNew`, and empty domain
  metadata.
- Organization and collection behavior remains intentionally out of alpha scope.
- GitHub Release publication remains separately approval-gated.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not add policy management, enforcement, organization policy behavior, or
  custom equivalent-domain configuration.

## Risks

- Returning metadata without auth could expose future policy state. Mitigation:
  use the existing bearer-auth helper.
- Direct domain metadata could diverge from sync. Mitigation: share the same
  response helper.
- Empty policy responses could be mistaken for policy support. Mitigation:
  document that policy management/enforcement remains unimplemented.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-routes`: Add authenticated metadata read routes and shared response
  helpers.
- `02-tests-fixtures-docs`: Add HTTP tests, compatibility fixtures, matrix
  updates, and current-state notes.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only read-only empty metadata behavior backed by existing sync semantics.
Reject policy enforcement, policy mutation, custom domains, or organization
scope in this workflow.

## Verification

- `pnpm exec vitest run test/app.test.ts test/compat/client-matrix.test.ts test/compat/compat-fixtures.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

The `metadata_read` fixture flow is the reusable compatibility contract for
empty policy and domain metadata responses.
