# Orchestration: Week 26 TOTP Login Fixture Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If replay fails with `invalid_grant`, inspect the fixed system time,
  challenge hash, and encrypted TOTP secret before changing fixture assertions.
- If fake timers leak into other fixtures, isolate replay execution in
  try/finally and always restore real timers.
- If exact generated token values differ, keep assertions shape-based.

## Packet Prompts

### 01-route-replay

Objective: add `token/totp-login-success.json` to route replay with explicit
`allowMutatingFixtures: true`, deterministic system time, and seeded TOTP
challenge.
Ownership: `test/compat/fixture-route-replay.test.ts`.
Expected output: targeted route replay passes.

### 02-docs-evidence

Objective: update current-state docs and workflow evidence.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm TOTP login fixture is route replayed.
- Confirm fake timers are restored after replay.
- Confirm default mutating fixture guard still rejects `folders/create`.
- Confirm local checks and CI pass.
