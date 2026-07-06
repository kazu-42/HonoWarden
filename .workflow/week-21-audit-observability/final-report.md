# Final Report: Week 21 Audit Observability

## Outcome

Week 21 audit observability is implemented locally. The slice adds a secret-safe audit event builder, opt-in JSON-line emission, initial route instrumentation, and operator documentation.

## Accepted Results

- Audit events have stable schema version `1`.
- Audit logging is disabled by default and enabled only by `HONOWARDEN_AUDIT_LOGS=true`.
- Audit context filtering removes known secret-like fields by key.
- Password-grant failures, refresh-token reuse, bootstrap success, and device revoke outcomes emit events when logging is enabled.
- Events are documented as sensitive operational metadata.

## Rejected Results

- Logging request or response bodies.
- Logging passwords, refresh tokens, token hashes, encrypted payloads, or vault fields.
- Adding a vendor-specific log sink in this slice.
- Persisting audit rows in D1 before retention requirements are clear.

## Conflicts Resolved

- Chose opt-in platform JSON lines over always-on logs to avoid noisy local development and accidental retention.
- Kept backup auditability runbook-based for now because backup/restore remains an operator CLI flow.

## Verification Evidence

- `pnpm test -- test/domain/audit.test.ts test/app.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan: no content hits
- repository path brand scan: no path hits
- workflow verifier: passed
- GitHub Actions CI run `28795947455`: passed
  - https://github.com/kazu-42/HonoWarden/actions/runs/28795947455

## Remaining Risks

- No live log-retention or access-control verification has been recorded.
- Sanitization by key name is a guardrail and must not justify logging arbitrary raw payloads.
- Vault CRUD events are not yet instrumented.
- Backup/restore event ingestion is not automated.

## Reusable Follow-up

- Reuse `buildAuditEvent` for future session lifecycle, backup execution, and security review evidence.
