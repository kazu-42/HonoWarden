# Packet 01: Preflight Script

## Objective

Add a read-only release gate script.

## Scope

- `scripts/honowarden-release-gate.mjs`
- `package.json`

## Tasks

- Add `pnpm release:gate`.
- Check repository-local release evidence.
- Report alpha blockers as `block`.
- Add `--strict` mode for release automation.

## Acceptance

- Default mode exits zero and prints JSON.
- Strict mode exits non-zero while blockers remain.
- The script does not call external systems.
