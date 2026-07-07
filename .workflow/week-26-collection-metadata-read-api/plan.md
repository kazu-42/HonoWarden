# Week 26 Collection Metadata Read API

## Goal

Expose authenticated read-only collection metadata endpoints that align with the
empty `Collections` array already returned by sync, without implementing
collection management.

## Success Criteria

- `GET /api/collections` returns an authenticated empty list response.
- `GET /api/collections/:id` returns an authenticated stable
  `collection_not_found` response.
- Non-GET collection routes continue to return the existing alpha unsupported
  response.
- Compatibility fixture coverage records collection list and not-found read
  behavior.
- Current-state docs record the read-only scope and remaining non-goals.
- Local verification passes for touched tests, workflow artifact, typecheck,
  lint, full test suite, format check, release gate, release status packet, and
  repository brand scan.

## Current Context

- `/api/sync` already returns `Collections: []`.
- Collection mutation and organization-scoped collection behavior are outside
  the alpha scope.
- GitHub Release publication remains separately approval-gated.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not implement collection creation, updates, deletion, assignment, or
  organization scope.

## Risks

- A direct collection endpoint could imply collection support. Mitigation: only
  expose empty read metadata and keep mutation routes explicitly unsupported.
- Route order could accidentally shadow unsupported mutation routes. Mitigation:
  add exact `GET` routes before the existing `all` guards and keep mutation
  route tests.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-routes`: Add authenticated collection metadata read routes.
- `02-tests-fixtures-docs`: Add HTTP tests, compatibility fixtures, and
  current-state notes.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only read-only empty collection metadata behavior. Reject collection
mutation, assignment, organization scope, or storage changes in this workflow.

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

The collection metadata fixtures are part of the `metadata_read` compatibility
contract for empty alpha metadata.
