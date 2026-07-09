# Packet: App, Retention, And Docs

## Objective

Integrate audit persistence into the existing opt-in audit emission path, add
retention cleanup, and document operator policy.

## Scope

- `src/app.ts`
- `src/maintenance/retention-cleanup.ts`
- audit/security/release docs
- app and scheduled tests

## Verification

- Route tests prove console audit output is preserved and D1 insert happens.
- Route tests prove opt-in audit persistence failures do not silently fall back.
- Scheduled tests prove 365-day bounded deletion is wired through cron cleanup.
