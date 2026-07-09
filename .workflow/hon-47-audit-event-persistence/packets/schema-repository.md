# Packet: Schema And Repository

## Objective

Add forward-only D1 schema and repository helpers for secret-safe audit event
persistence and bounded retention deletion.

## Scope

- `migrations/0007_audit_events.sql`
- `src/repositories/audit-event-repository.ts`
- `test/repositories/audit-event-repository.test.ts`
- migration and fake D1 test support

## Verification

- Repository tests prove sanitized context is persisted into explicit columns.
- Migration tests prove the table and indexes exist and plaintext IP columns do
  not.
