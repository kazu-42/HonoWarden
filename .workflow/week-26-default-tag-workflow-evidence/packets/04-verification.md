# Packet ID: 04-verification

Objective:

Record local checks, review, CI, and readback evidence.

Required local checks:

- Focused packet tests.
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm compat:test`
- `pnpm release:gate -- --strict`
- `pnpm brand:scan`
- default readbacks without tag workflow args.
- `codex review --uncommitted`

Status:

pending.
