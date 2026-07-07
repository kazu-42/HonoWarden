# Week 26 Direct Vault Read APIs

## Goal

Add owner-scoped direct read endpoints for folders and ciphers so clients can
list and fetch stored vault objects without relying only on full sync.

## Success Criteria

- `GET /api/folders` returns authenticated active folders for the current user.
- `GET /api/folders/:id` returns one active folder or `folder_not_found` for
  missing, deleted, or cross-user rows.
- `GET /api/ciphers` returns authenticated ciphers for the current user,
  including trashed rows to match sync.
- `GET /api/ciphers/:id` returns one current-user cipher, including trashed rows,
  or `cipher_not_found` for missing or cross-user rows.
- Repository tests prove the SQL remains owner-scoped and uses the intended
  deleted-row policy.
- Compatibility fixture flow `direct_read` covers folder and cipher list/get
  responses.
- Local verification passes for touched tests, workflow artifact, typecheck,
  lint, full test suite, format check, release gate, release status packet, and
  repository brand scan.

## Current Context

- Full sync already returns folders and ciphers.
- Folder and cipher mutation routes already exist.
- Direct folder/cipher reads were missing and previously fell through to generic
  `404`.
- GitHub Release publication remains separately approval-gated.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not implement pagination, attachment reads, collection reads, or
  organization/shared-vault behavior in this slice.

## Risks

- Direct list and sync list could diverge. Mitigation: reuse existing repository
  list functions and response builders.
- Single-row lookup could expose cross-user data. Mitigation: owner-scoped SQL,
  HTTP cross-user tests, and repository binding assertions.
- Folder and cipher deleted-row policies differ. Mitigation: document and test
  active-only folders vs active-and-trashed ciphers.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-repositories-routes`: Add owner-scoped repository lookups and direct read
  routes.
- `02-tests-fixtures-docs`: Add HTTP tests, repository tests, compatibility
  fixtures, matrix updates, and current-state notes.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only read-only personal-vault folder/cipher reads backed by existing
storage rows. Reject pagination, attachment, collection, or shared-vault
behavior in this workflow.

## Verification

- `pnpm exec vitest run test/app.test.ts test/repositories/folder-repository.test.ts test/repositories/cipher-repository.test.ts test/compat/client-matrix.test.ts test/compat/compat-fixtures.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

The `direct_read` fixture flow is the reusable compatibility contract for direct
folder and cipher reads.
