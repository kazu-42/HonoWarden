# HON-47 audit event persistence

## Goal

Implement D1-backed audit event persistence for the existing secret-safe Worker
audit events and document the retention, access, export, and deletion policy.

## Success Criteria

- Add a D1 `audit_events` schema that stores structured audit metadata without
  request bodies, response bodies, tokens, password hashes, TOTP secrets, raw IP
  addresses, vault payloads, or encrypted vault values.
- Persist built `AuditEvent` records when `HONOWARDEN_AUDIT_LOGS=true` while
  preserving the existing console JSON-line emission.
- Keep audit persistence opt-in in deployable Wrangler environments.
- Fail loudly when opt-in persistence cannot write to D1.
- Add bounded scheduled deletion for retained audit rows and document the
  365-day retention boundary.
- Cover sanitization-before-persistence, migration shape, and cleanup behavior
  with tests.

## Current Context

- `src/domain/audit.ts` already builds sanitized event objects and serializes
  them for console logging.
- `src/app.ts` emits audit events for bootstrap, auth failures, refresh reuse,
  backup export, device revoke, session revoke-all, and TOTP operations.
- `src/maintenance/retention-cleanup.ts` already runs hourly bounded cleanup for
  auth defense and TOTP challenge data.

## Constraints

- No production migration or deploy in this issue.
- Existing audit logging remains opt-in via `HONOWARDEN_AUDIT_LOGS=true`.
- Do not persist secrets, encrypted vault payloads, token material, request
  bodies, response bodies, or plaintext IP addresses.
- Keep changes compatible with existing Hono route tests and fake D1 support.

## Risks

- If persistence errors are swallowed, operators may believe audit evidence
  exists when it was dropped.
- If migration stores full event JSON only, sensitive fields could be added
  later by accident; prefer explicit columns plus sanitized `context_json`.
- If cleanup is unbounded, hourly cron could create table churn.

## Approval Required

- Production migration or deploy would require separate explicit approval.
- Local schema/tests/docs are covered by the user's autonomous execution
  instruction.

## Work Packets

- Schema/repository: add migration and D1 repository helpers for insert/delete.
- App integration: make audit emission awaitable and persist opt-in events.
- Retention/docs: wire bounded cleanup and update operational/security docs.
- Verification: run focused tests first, then full repo gate.

## Integration Policy

Keep repository helpers small and event-shape-compatible. Any failure to persist
when audit logging is enabled should surface as a database/audit infrastructure
failure instead of silently falling back to console-only evidence.

## Verification

- `pnpm exec vitest run test/domain/audit.test.ts test/migrations.test.ts test/app.test.ts --testNamePattern "audit|migration"`
- `pnpm exec vitest run test/scheduled.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm release:gate -- --strict`
- workflow verifier

## Reusable Artifacts

This workflow records the persistence and retention baseline for HON-48 audit
coverage expansion and HON-49/HON-50 operational metrics follow-up.
