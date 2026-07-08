# Packet 02: Readiness And Evidence

## Objective

Keep operations readiness and release evidence aligned with the current
Cloudflare blocker.

## Scope

- `scripts/honowarden-ops-readiness-packet.mjs`
- `test/ops/ops-readiness-packet.test.ts`
- `docs/release/email-routing-evidence.md`
- `docs/release/ops-rollback-evidence.md`
- `docs/current-state.md`
- `test/release-docs.test.ts`

## Constraints

- Do not mark Email Routing evidence as `passed`.
- Do not treat local forwarding inputs as live delivery proof.
- Keep rollback evidence `partial` until rollback commands and rehearsals are
  real.

## Expected Output

- Ops readiness JSON exposes `failedChecks`.
- A token-only blocker is reported as `cloudflare_api_token_missing`.
- Release docs record readback while preserving conservative status.
