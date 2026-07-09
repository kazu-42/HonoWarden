# Packet: schema-repository

## Objective

Add owner-scoped D1 metadata for cipher attachments and repository operations
that never derive authorization from R2 object keys.

## Scope

- `migrations/0006_cipher_attachments.sql`
- `src/repositories/attachment-repository.ts`
- migration and repository tests

## Verification

- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts`
