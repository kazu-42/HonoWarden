# Result 02: Route Instrumentation

Accepted:

- Added opt-in audit emitter in `src/app.ts`.
- Added password-grant failure audit events.
- Added refresh-token reuse audit events.
- Added bootstrap success audit events.
- Added device revoke success and not-found audit events.
- Added `HONOWARDEN_AUDIT_LOGS=false` defaults to Wrangler environments.
- Regenerated Worker configuration types.

Rejected:

- Always-on audit logs.
- Logging request bodies, tokens, passwords, hashes, or encrypted payloads.

Verification:

- `pnpm test -- test/domain/audit.test.ts test/app.test.ts`
- `pnpm check`
- `pnpm lint`
