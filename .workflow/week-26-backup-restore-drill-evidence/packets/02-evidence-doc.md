# Packet 02: Evidence Doc

## Objective

Record drill evidence and ensure release gate preflight validates evidence
fields.

## Scope

- `docs/release/backup-restore-drill-evidence.md`
- `docs/release/index.md`
- `docs/release/release-gate-preflight.md`
- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`
- `test/release-docs.test.ts`
- `docs/current-state.md`

## Tasks

- Add evidence with source commit, Wrangler version, commands, manifest checksum,
  restored table list, and limitations.
- Require key evidence fields in the release gate preflight.
- Update release gate tests to expect backup evidence pass.
- Keep remaining release blockers explicit.

## Acceptance

- `pnpm release:gate` reports backup evidence as pass.
- Live-client, staging, and Cloudflare evidence remain blocking.
