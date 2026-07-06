# Week 10 Cipher Create

## Goal

Implement authenticated login cipher create and include active ciphers in sync.

## Success Criteria

- Cipher payloads are persisted as opaque encrypted JSON.
- `POST /api/ciphers` creates a user-owned login cipher.
- Optional folder association is validated against the authenticated user.
- `GET /api/sync` includes active ciphers.
- Full local checks and CI pass.

## Current Context

- Week 9 added owner-scoped folder CRUD and shared protected-route authentication.
- D1 already has a `ciphers` table with `encrypted_json`, `type`, `favorite`, `folder_id`, `revision_date`, and soft-delete fields.
- Cipher update/delete is intentionally deferred.

## Constraints

- Do not decrypt, inspect, normalize, or log encrypted cipher fields.
- Do not implement cipher update, delete, restore, attachments, collections, or sends in this slice.
- Keep upstream-provider brand strings out of tracked files.
- Do not set real secrets or deploy.

## Risks

- A cipher could reference another user's folder if ownership is not checked.
- Server-side metadata merging could accidentally let client-provided IDs override stored IDs.
- Storing malformed encrypted JSON could break sync parsing.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resources.

## Work Packets

- `01-cipher-repository`: list and create user-scoped ciphers.
- `02-folder-ownership`: add folder ownership check for cipher create.
- `03-cipher-route-sync`: route validation, create response, and sync inclusion.
- `04-verification`: full checks, smoke, workflow report, push, CI.

## Integration Policy

Any owner-scope failure blocks push. Any route that accepts missing/invalid tokens blocks push. Any server-side plaintext cipher field blocks push.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification

## Reusable Artifacts

- `.workflow/week-10-cipher-create/`
