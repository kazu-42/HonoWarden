# Packet 02: Route Instrumentation

Objective: emit first useful audit events from Worker routes.

Ownership:

- `src/app.ts`
- `src/bindings.ts`
- `wrangler.jsonc`
- `worker-configuration.d.ts`
- `test/app.test.ts`
- `test/wrangler-environments.test.ts`

Expected output:

- Opt-in JSON-line emission.
- Password-grant failure event.
- Refresh-token reuse event.
- Bootstrap success event.
- Device revoke success and not-found events.
- Audit logging disabled by default in Wrangler environments.

Verification:

- `pnpm test -- test/domain/audit.test.ts test/app.test.ts`
- `pnpm check`
- `pnpm lint`
