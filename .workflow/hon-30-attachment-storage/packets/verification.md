# Packet: verification

## Objective

Run broad local verification before PR and record the evidence.

## Checks

- targeted vitest suites
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `git diff --check`
- workflow verifier
