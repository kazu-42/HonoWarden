# Week 9 Folder CRUD

## Goal

Implement authenticated folder CRUD and include active folders in sync.

## Success Criteria

- Folder names are stored only as opaque encrypted strings.
- Folder reads and writes are scoped to the authenticated user.
- `GET /api/sync` includes active folders.
- Create, update, and delete routes have stable success and failure responses.
- Full local checks and CI pass.

## Current Context

- Week 8 added access-token verification and authenticated empty sync.
- D1 already has a `folders` table with `encrypted_name`, `revision_date`, and soft-delete columns.
- Folder CRUD is the next roadmap increment before cipher CRUD.

## Constraints

- Do not implement ciphers, collections, organizations, or sends.
- Do not decrypt, inspect, normalize, or log folder names.
- Keep upstream-provider brand strings out of tracked files.
- Do not set real secrets or deploy.

## Risks

- Cross-user update/delete could leak or modify another user's folder.
- Treating encrypted folder names as normal plaintext could corrupt payloads.
- Delete semantics must not remove data before backup/restore and revision behavior are mature.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resources.

## Work Packets

- `01-folder-repository`: list/create/update/soft-delete folders with owner scoping.
- `02-auth-helper`: share protected-route authentication across sync and folders.
- `03-folder-routes`: HTTP routes, DTOs, validation, sync integration.
- `04-verification`: full checks, smoke, workflow report, push, CI.

## Integration Policy

Any owner-scope failure blocks push. Any route that accepts missing/invalid tokens blocks push.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification

## Reusable Artifacts

- `.workflow/week-9-folder-crud/`
