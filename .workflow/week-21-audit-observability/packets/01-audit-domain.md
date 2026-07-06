# Packet 01: Audit Domain

Objective: define the audit event contract and sanitization rules.

Ownership:

- `src/domain/audit.ts`
- `test/domain/audit.test.ts`

Expected output:

- Stable audit event shape.
- JSON serializer.
- Opt-in env parser.
- Secret-like context key filtering.

Verification:

- `pnpm test -- test/domain/audit.test.ts`
