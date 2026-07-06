# Spec: Week 12 Multi Item Round Trip

## Summary

Week 12 hardens sync for 10 to 50 personal vault items. Login ciphers, secure-note ciphers, favorite flags, and unknown encrypted fields must round-trip without server-side decryption.

## Inputs

- `POST /api/ciphers`
- `PUT /api/ciphers/:id`
- `GET /api/sync`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`

## Outputs

- Valid login and note cipher create/update:
  - opaque encrypted JSON fields returned unchanged except for server-owned metadata
- Valid sync:
  - active folders and 10 to 50 active ciphers returned for the authenticated user
  - favorite flags preserved
  - unknown encrypted payload fields preserved

## Behavior

1. The server accepts login and secure-note cipher types.
2. Cipher payloads are stored as opaque JSON strings.
3. Server-owned metadata (`id`, `object`, `organizationId`, `folderId`, `type`, `favorite`, `revisionDate`, `creationDate`, `deletedDate`) remains authoritative in responses.
4. Unknown encrypted payload fields are preserved in create, update, and sync responses.
5. Sync returns active ciphers ordered by repository order and excludes deleted ciphers through the repository query.
6. No plaintext vault data fields are added to the schema or logs.

## Edge Cases

- Unsupported cipher type returns `400`.
- Malformed folder IDs still return `400`.
- Cross-user folders still return `404`.
- Large sync response with 50 ciphers remains in-memory only for this slice; pagination is deferred.

## Acceptance Criteria

- [x] HTTP tests cover secure-note cipher create.
- [x] HTTP tests cover unknown encrypted fields on create and update.
- [x] HTTP tests cover 50 active ciphers in sync.
- [x] Existing cipher lifecycle tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
