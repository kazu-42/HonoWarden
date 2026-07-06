# Final Report: Week 17 Login Defenses

## Outcome

Week 17 login defenses are implemented locally. Password grant now has account-based temporary lockout and client-address failed-attempt rate limiting while keeping generic token error wording.

## Accepted Results

- Added login-defense domain policy helpers and tests.
- Added D1 migration for account lockout state, hashed auth-attempt buckets, and atomic failure buckets.
- Added auth repository operations for failed attempt counting, attempt recording, atomic failure bucket updates, failed-login state, and reset.
- Integrated IP rate limiting and account lockout into password grant with D1 conflict updates for failed-attempt counters.
- Added Week 17 spec and current-state documentation.

## Rejected Results

- No live D1 migration was applied.
- No deploy was performed.
- No real client login attempts, secrets, or vault data were used.
- No plaintext IP storage was introduced.

## Conflicts Resolved

- The route preserves generic `invalid_grant` wording even for lockout/rate-limit paths to avoid account-existence leaks.

## Verification Evidence

- `pnpm format:write`: completed with no content changes required.
- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 16 files and 149 tests.
- `pnpm compat:test`: passed, 2 files and 9 tests.
- `pnpm format`: passed.
- Repository brand scan: passed with no hits.
- Workflow verification: passed for `.workflow/week-17-login-defenses`.
- Independent Spark review found stale read-then-write counter risk; the final implementation now uses D1 conflict updates for failed-attempt buckets.
- GitHub Actions CI: passed for run `28792001261` on commit `82666e9e54d574bc11bbc2aaa4923459b46d4e1d`.

## Remaining Risks

- Auth-attempt retention cleanup is still future work.
- Live D1 migration and deployed behavior have not been verified.
- Operator metrics/alerts for login defenses are not implemented yet.

## Reusable Follow-up

- Add retention cleanup for `auth_attempts`.
- Add audit-safe metrics for lockout/rate-limit events.
- Apply migration to staging D1 and capture staging health/login-defense evidence.
