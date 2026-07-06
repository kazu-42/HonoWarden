# Spec: Week 10 Cipher Create

## Summary

Week 10 adds authenticated creation of one login item cipher and includes active ciphers in sync. Cipher content remains opaque encrypted JSON to the server.

## Inputs

- `POST /api/ciphers`
- `GET /api/sync`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid cipher create:
  - HTTP `201`
  - cipher response with generated `id`, `object`, `type`, `folderId`, `favorite`, `revisionDate`, `creationDate`, and opaque encrypted fields from the request
- Valid sync:
  - HTTP `200`
  - `Ciphers` contains active ciphers for the authenticated user
- Missing, invalid, expired, disabled-user, or missing-secret access token:
  - stable JSON error response

## Behavior

1. Cipher create uses the same protected-route authentication as sync and folder routes.
2. The request body is stored as JSON in `ciphers.encrypted_json`.
3. The server validates only structural metadata: `type`, optional `folderId`, and optional `favorite`.
4. If `folderId` is present, it must belong to the authenticated user and must not be deleted.
5. Cipher reads and writes are scoped by `user_id`.
6. Deleted ciphers are excluded from full sync.

## Edge Cases

- Missing or malformed request body returns `400`.
- Unsupported cipher type returns `400`.
- Cross-user or deleted folder ID returns `404`.
- Disabled users cannot create or sync ciphers.
- D1 errors return `503`.

## Acceptance Criteria

- [x] Repository tests cover list and create with owner-scoped fields.
- [x] Folder ownership check is tested for cipher create.
- [x] HTTP tests cover cipher create, sync-with-ciphers, invalid body, and missing folder.
- [x] Existing folder and sync tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
