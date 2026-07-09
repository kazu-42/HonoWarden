# Packet 01: CLI

## Objective

Create `pnpm secret:rotation:drill` as a repository-local dry-run command.

## Scope

- `scripts/honowarden-secret-rotation-drill.mjs`
- `package.json`

## Requirements

- Emit JSON only on success.
- Support `dry-run`, `--strict`, and `--out`.
- Record credential classes, environment variable names, configured booleans,
  blast radius, live rotation shape, verification, rollback, and global safety
  rules.
- Never print or persist actual secret values.
- Do not call external APIs or mutate live systems.

## Verification

- `pnpm secret:rotation:drill -- dry-run --strict`
- `pnpm secret:rotation:drill -- dry-run --strict --out test/.tmp/secret-rotation-drill.json`
