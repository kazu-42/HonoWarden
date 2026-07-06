# Week 17 Login Defenses

## Goal

Add tested login defenses for password grant without weakening client-compatible error wording.

## Success Criteria

- Account failed-login state is stored in D1 and reset after a successful password grant.
- Repeated failed password grants temporarily lock an existing account.
- Client IP failed-attempt buckets are stored without plaintext IP addresses and enforce a temporary rate limit.
- Token endpoint keeps safe generic `invalid_grant` wording for unknown users, wrong passwords, locked users, and IP-limited callers.
- IP-limited callers receive HTTP `429` with `Retry-After`; account lockout keeps the generic body.
- Migration tests cover new schema and indexes.
- Full local gates pass: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, brand scan, workflow verification, and CI.

## Current Context

Week 16 made environment separation testable. Week 17 roadmap calls for IP and account-based rate limits, temporary lockout, and safe error wording.

## Constraints

- Do not store plaintext client IP addresses.
- Do not reveal whether a user exists.
- Do not change successful token response shape.
- Keep external provider brand strings out of tracked source and docs.
- Keep route handlers thin; reusable policy and persistence code should live outside `src/app.ts` where practical.

## Risks

- Overly strict status/body changes can break clients that expect token endpoint OAuth-style errors.
- Persisting raw IP addresses increases privacy and operational risk.
- Lockout policy can accidentally lock real users for too long if thresholds are too aggressive.
- Migration changes must remain compatible with local D1 and FakeD1 tests.

## Approval Required

No extra approval is required for local code, tests, docs, git push, and CI. Ask before applying migrations to live D1, deploying, setting secrets, or running live login attempts.

## Work Packets

- `01-defense-domain`: add policy helpers for environment-safe lockout and hashed attempt buckets.
- `02-schema-repository`: add migration, repository operations, and FakeD1 support.
- `03-route-integration`: integrate defenses into password grant route with safe wording.
- `04-docs-verification`: update specs/current-state/workflow, run gates, push, and watch CI.

## Integration Policy

Do not ship if any error path reveals account existence, if plaintext IP addresses are stored, if successful token response changes, or if the lockout state is not reset on successful login.

## Verification

- Targeted RED tests before implementation.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI

## Reusable Artifacts

- `src/domain/login-defense.ts`
- migration `0002_login_defenses.sql`
- `docs/current-state.md`
- `.workflow/week-17-login-defenses/`
