# Packet: api-routes

## Objective

Implement authenticated cipher-scoped attachment upload, download, delete, and
sync/list/read metadata injection.

## Scope

- `src/app.ts`
- `src/infra/db-health.ts`
- app tests and fake D1/R2 support

## Verification

- `pnpm exec vitest run test/app.test.ts`
- `pnpm check`
