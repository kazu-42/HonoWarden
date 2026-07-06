# Integration Checklist: week-11-cipher-lifecycle

## Accepted

- Cipher lifecycle repository operations are owner-scoped.
- Permanent delete is guarded by `id` and `user_id`.
- Lifecycle routes reuse protected-route authentication.
- Update validates optional folder ownership.
- Tests cover success and not-found paths.

## Rejected

- No revision conflict checks were added.
- No attachments, collections, sends, or organizations were added.
- No real secrets were set.
- No Cloudflare deploy was performed.

## Conflicts

- None.

## Decisions

- Trash and restore return minimal cipher metadata rather than encrypted payloads.
- Permanent delete returns `object: cipherDeletion`.
- Missing, deleted, or cross-user ciphers return the same `404 cipher_not_found`.

## Verification Still Needed

- None for implementation commit `bf8ba2c`; CI passed in run `28787168460`.
