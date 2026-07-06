# Integration Checklist: week-08-empty-vault-sync

## Accepted

- Token verification helper is available to protected routes.
- Auth repository can re-load users by ID for token claim validation.
- `/api/sync` returns the empty personal sync shape for a valid access token.
- Disabled users and security-stamp mismatches fail closed.

## Rejected

- No folder, collection, cipher, or send persistence was added in this slice.
- No real secrets were set.
- No Cloudflare deploy was performed.

## Conflicts

- None.

## Decisions

- `/api/sync` checks `HONOWARDEN_TOKEN_SECRET` before parsing authorization, so a misconfigured server fails as `503`.
- Sync authorization does not disclose whether a token maps to an unknown, disabled, or modified user.
- `Profile.CreationDate` comes from `users.created_at`.

## Verification Still Needed

- None for implementation commit `f54bb67`; CI passed in run `28786039559`.
