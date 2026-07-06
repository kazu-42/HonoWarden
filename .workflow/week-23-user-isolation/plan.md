# Week 23 User Isolation

## Goal

Add focused alpha evidence that multiple personal vault users remain isolated
and disabled accounts cannot keep using auth flows.

## Success Criteria

- HTTP sync coverage proves two users only receive their own folders and ciphers
  when the backing store contains both users' rows.
- Password grants for disabled users fail with the same generic invalid-grant
  response used for other credential failures.
- Refresh grants for disabled users fail before token rotation.
- FakeD1 test support can model multiple users without weakening existing
  owner-scoped repository tests.
- Docs and workflow artifacts record the scope and remaining gaps.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

Week 22 broadened compatibility fixtures. Week 23 roadmap requires separate
dogfood users and disabled-user rejection. The production queries are already
owner-scoped, so this slice focuses on executable regression evidence.

## Constraints

- Use only synthetic account and vault data.
- Do not touch live Cloudflare, Linear, or production resources.
- Do not introduce direct external provider brand strings in tracked files.
- Keep behavior generic for disabled users to avoid account-state disclosure.

## Risks

- A fake database that returns unfiltered rows can make sync tests look stronger
  than they are.
- Disabled-user failures must not leak account state through response wording.
- Repository owner-scope tests should remain the source of truth for SQL query
  predicates.

## Approval Required

No approval is required for local tests, docs, git push, and CI. Live dogfood
account setup requires a separate external-operations gate.

## Work Packets

- `01-fake-d1-multi-user`: Add multi-user lookup and user-bound row filtering to
  test support.
- `02-http-isolation-tests`: Add HTTP tests for two-user sync isolation and
  disabled auth failures.
- `03-docs-verification`: Document Week 23 status and verification evidence.

## Integration Policy

Keep production code unchanged unless a real bug is found. Prefer tests and fake
database fidelity improvements because production repository predicates already
bind `user_id`.

## Verification

- `pnpm test -- test/app.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
