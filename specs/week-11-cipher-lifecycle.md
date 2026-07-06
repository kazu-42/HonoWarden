# Spec: Week 11 Cipher Lifecycle

## Summary

Week 11 adds authenticated cipher update, trash, restore, and permanent delete. Cipher payloads remain opaque encrypted JSON to the server.

## Inputs

- `PUT /api/ciphers/:id`
- `DELETE /api/ciphers/:id`
- `PUT /api/ciphers/:id/restore`
- `DELETE /api/ciphers/:id/delete`
- `GET /api/sync`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid cipher update:
  - HTTP `200`
  - cipher response with server-owned metadata and request encrypted fields
- Valid cipher trash:
  - HTTP `200`
  - cipher response with `deletedDate`
- Valid cipher restore:
  - HTTP `200`
  - cipher response with `deletedDate: null`
- Valid permanent delete:
  - HTTP `200`
  - deletion response with `object`, `id`, and `revisionDate`
- Unknown, deleted, or cross-user rows:
  - stable `404`

## Behavior

1. All cipher lifecycle routes use protected-route authentication.
2. Update only applies to active ciphers owned by the authenticated user.
3. Trash sets `deleted_at` and updates `revision_date`.
4. Restore clears `deleted_at` for trashed ciphers owned by the authenticated user.
5. Permanent delete physically removes a row only when it belongs to the authenticated user.
6. Optional folder references on update must belong to the authenticated user and must not be deleted.
7. Full sync continues to exclude trashed or permanently deleted ciphers.

## Edge Cases

- Missing or malformed update body returns `400`.
- Unsupported cipher type returns `400`.
- Cross-user or deleted folder ID returns `404`.
- Updating a trashed cipher returns `404`.
- Restoring an active or missing cipher returns `404`.
- Disabled users cannot mutate ciphers.
- D1 errors return `503`.

## Acceptance Criteria

- [x] Repository tests cover update, trash, restore, permanent delete, and not-found behavior.
- [x] HTTP tests cover update, trash, restore, permanent delete, invalid body, missing folder, and not-found cases.
- [x] Existing cipher create and sync tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
