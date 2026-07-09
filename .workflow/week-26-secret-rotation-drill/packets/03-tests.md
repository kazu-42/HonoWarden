# Packet 03: Tests

## Objective

Prove the dry-run command and documentation boundaries are reviewable and
secret-safe.

## Scope

- `test/ops/secret-rotation-drill.test.ts`
- `test/security-docs.test.ts`

## Requirements

- Assert the packet status, action, dry-run flags, and nine covered credential
  classes.
- Assert each class has verification commands and rollback guidance.
- Assert supplied fake secret values and private destination emails are absent
  from stdout and generated evidence files.
- Assert docs say formal dry-run evidence exists without removing live rotation
  gaps.

## Verification

- `pnpm exec vitest run test/ops/secret-rotation-drill.test.ts test/security-docs.test.ts`
- `pnpm test`
