# HON-41 Backup Export API

## Goal

Implement HON-41 by adding a server-side user vault backup export API guarded by
recent password authentication, while keeping operator production
backup/restore on the existing CLI path.

## Success Criteria

- `POST /api/accounts/export` requires a bearer access token whose
  `authMethod` is `password` and whose issue time is within the existing
  five-minute recent-auth window.
- The export response is owner-scoped and includes only the authenticated user's
  account metadata, folders, ciphers, and attachment metadata.
- The export response omits password hashes, refresh-token material, raw R2
  object bodies, R2 object keys, and cross-user rows.
- Export attempts emit secret-safe audit events when audit logging is enabled.
- Docs explain rate-limit, timeout/failure, audit, and operator backup
  boundaries.
- Local targeted tests, full test suite, typecheck, lint, format, diff check,
  workflow verification, PR CI, and main CI all pass before Linear closeout.

## Current Context

- HON-30 already added R2-backed cipher attachment metadata and sync response
  integration.
- Existing recent-auth helper is `authenticateRecentPasswordRequest`; it rejects
  refresh-auth, stale password-auth, and legacy claimless access tokens with
  `reauth_required`.
- Existing operator backup/restore CLI is `scripts/honowarden-backup.mjs` and
  remains the production disaster-recovery path.
- Audit events are structured log lines only; D1 persistence is covered by
  later HON-47/HON-48 work.

## Constraints

- Do not deploy Workers, apply migrations, or run production backup/export
  mutations for this issue.
- Do not introduce fake in-memory rate limits that would be unreliable on
  Workers.
- Do not expose raw attachment object bodies or R2 object keys from the public
  API.
- Keep implementation aligned with the existing single-file Hono app and fake
  D1 test patterns.

## Risks

- A public export route can become an exfiltration path if it accepts
  refresh-auth or stale tokens.
- Export payloads still contain encrypted vault data and account key material;
  response caching must be disabled and docs must treat exports as sensitive.
- Cross-user leakage is the highest correctness risk; all repository reads must
  bind `auth.user.id`.
- Export-specific rate limiting is still future work under HON-46; this issue
  must document that boundary instead of implying a false throttle.

## Approval Required

- No approval is required for local code, tests, docs, PR, and Linear/GitHub
  closeout.
- Approval is required before any Cloudflare deploy, migration, production D1/R2
  export, or live client export smoke.

## Work Packets

- Discovery: read auth/recent-auth, sync/vault read models, audit, backup docs,
  and fake D1 patterns.
- TDD: add app tests for recent-auth guard, owner-scoped export, secret omission,
  and audit event safety.
- Implementation: add the route and response builder using existing
  owner-scoped repository helpers.
- Docs: update current state, backup/restore, audit/security docs, and workflow
  report.
- Verification: run targeted tests first, then broad local checks and CI/merge
  readback.

## Integration Policy

- Prefer existing helpers over new abstractions.
- Keep public response field names stable and documented in tests.
- Reject any implementation that queries tables without a user-id predicate.

## Verification

- `pnpm exec vitest run test/app.test.ts test/domain/audit.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `git diff --check`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/hon-41-backup-export-api`

## Reusable Artifacts

- Keep this workflow artifact as the reviewable HON-41 closeout record.
