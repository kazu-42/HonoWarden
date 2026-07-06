# Spec: Week 09 Folder CRUD

## Summary

Week 09 adds authenticated folder CRUD for a personal vault. Folder names remain opaque encrypted strings to the server. Sync includes non-deleted folders for the authenticated user.

## Inputs

- `GET /api/sync`
- `POST /api/folders`
- `PUT /api/folders/:id`
- `DELETE /api/folders/:id`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid folder create/update:
  - HTTP `201` for create, `200` for update
  - folder response with `object`, `id`, `name`, and `revisionDate`
- Valid folder delete:
  - HTTP `200`
  - deletion response with `object`, `id`, and `revisionDate`
- Valid sync:
  - HTTP `200`
  - `Folders` contains active folders for the authenticated user
- Missing, invalid, expired, disabled-user, or missing-secret access token:
  - stable JSON error response

## Behavior

1. Every folder route uses the same access-token verification and user re-load as sync.
2. Folder names are accepted as opaque encrypted strings and persisted in `folders.encrypted_name`.
3. Folder reads and writes are scoped by `user_id`.
4. Updating or deleting an unknown, deleted, or cross-user folder returns `404`.
5. Deleting a folder sets `deleted_at` and updates `revision_date`; deleted folders are excluded from full sync.

## Edge Cases

- Missing or malformed folder `name` returns `400`.
- Empty folder `name` returns `400`.
- Unknown folder ID returns `404`.
- Disabled users cannot create, update, delete, or sync folders.
- D1 errors return `503`.

## Acceptance Criteria

- [x] Repository tests cover list, create, update, delete, and owner-scoped not-found behavior.
- [x] HTTP tests cover create, update, delete, sync-with-folders, invalid body, and not-found cases.
- [x] Existing token and sync auth tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
