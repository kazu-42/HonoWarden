# Week 21 Audit Observability

## Goal

Add a minimal secret-safe audit event spine for alpha operations without coupling
HonoWarden to a vendor-specific logging backend.

## Success Criteria

- Audit event schema is stable and covered by tests.
- Audit context sanitization removes secret-like fields.
- Audit logging is opt-in and disabled by default.
- Auth failures, refresh-token reuse, account bootstrap, and device revoke events are covered.
- Docs explain event shape, enabled state, and remaining gaps.
- Local gates, brand scan, workflow verifier, and CI pass.

## Current Context

Week 20 added operator backup/restore tooling and runbook evidence. Week 21
roadmap requires auth failures, device revokes, backups, and admin actions to be
auditable without logging secrets.

## Constraints

- Do not log request/response bodies.
- Do not log passwords, tokens, token hashes, encrypted vault payloads, or vault item fields.
- Do not add a vendor-specific observability dependency.
- Do not introduce direct external provider brand strings in tracked files.
- Keep default deployments quiet unless explicitly configured.

## Risks

- Logs can become sensitive operational metadata even when secret fields are filtered.
- Over-instrumenting every route can make compatibility debugging noisy.
- Sanitizing by key name is a guardrail, not a substitute for careful event design.

## Approval Required

No approval is required for local code, tests, docs, git push, and CI. Enabling audit logs in live Cloudflare environments requires a separate gate.

## Work Packets

- `01-audit-domain`: Add event schema, serializer, opt-in helper, and secret-key filtering tests.
- `02-route-instrumentation`: Emit opt-in audit events for auth failures, refresh reuse, bootstrap success, and device revoke.
- `03-docs-verification`: Document audit event contract, current-state increment, workflow evidence, and verification.

## Integration Policy

Keep audit output as JSON lines through the platform log stream. Persistence and vendor shipping remain future work after live retention requirements are known.

## Verification

- `pnpm test -- test/domain/audit.test.ts test/app.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI

## Reusable Artifacts

The audit event builder should be reused for future backup events, session lifecycle events, and security review evidence.
