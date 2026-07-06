# Integration Checklist: week-17-login-defenses

## Accepted

- Account lockout state is persisted on users.
- Client-address failed-attempt buckets are hashed before storage.
- Failed-attempt counters are advanced through D1 conflict updates.
- Password grant enforces IP rate limit and account lockout.
- Safe generic token error wording is preserved.
- Successful password grants reset login-defense state.

## Rejected

- No live D1 migration was applied.
- No deploy was performed.
- No live login attempts or real user data were used.
- No plaintext IP storage was introduced.

## Conflicts

- None.

## Verification Still Needed

- GitHub Actions CI after push.

## Local Verification Completed

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- Repository brand scan
- Workflow verification
