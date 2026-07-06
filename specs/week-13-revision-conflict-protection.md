# Spec: Week 13 Revision Conflict Protection

## Summary

Week 13 prevents stale folder and cipher updates from overwriting newer server state. Update requests must carry the caller's observed `revisionDate`; the server only writes when that value still matches the active row.

## Inputs

- `PUT /api/folders/:id`
- `PUT /api/ciphers/:id`
- `Authorization: Bearer <access token>`
- `HONOWARDEN_TOKEN_SECRET`
- request body `revisionDate` containing the caller's observed server revision

## Outputs

- Valid update with matching revision:
  - `200` response with a new server-generated `revisionDate`
- Missing or malformed request revision:
  - `400 invalid_request`
- Missing active owner-scoped record:
  - `404 not_found`
- Active owner-scoped record with a different current revision:
  - `409 revision_conflict`

## Behavior

1. Folder and cipher update requests require a non-empty string `revisionDate`.
2. Repository updates include `revision_date = ?` in the owner-scoped active-row predicate.
3. When a guarded update changes zero rows, the repository checks whether an active owner-scoped row still exists.
4. A missing active row is reported as not found.
5. A present active row with a different revision is reported as a conflict.
6. Cipher payloads remain opaque; server-owned response metadata remains authoritative.

## Edge Cases

- Create requests do not require a caller-observed revision.
- Delete, restore, and permanent delete keep their Week 11 behavior in this slice.
- Cross-user records are not revealed and continue to return `404`.
- Unsupported cipher types and missing folder ownership checks keep their existing response behavior.

## Acceptance Criteria

- [x] Repository tests cover matching, stale, and missing-row update outcomes for folders.
- [x] Repository tests cover matching, stale, and missing-row update outcomes for ciphers.
- [x] HTTP tests cover `409 revision_conflict` for stale folder and cipher updates.
- [x] HTTP tests cover `400 invalid_request` when update `revisionDate` is absent.
- [x] Existing lifecycle, sync, and round-trip tests continue to pass.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
