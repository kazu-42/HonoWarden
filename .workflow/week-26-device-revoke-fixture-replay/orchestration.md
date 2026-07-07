# Orchestration: Week 26 Device Revoke Fixture Replay

## Execution Rules

- Keep the objective to route replay and docs evidence.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If replay returns `401`, inspect token subject and seeded user security stamp.
- If replay returns `400 current_device_revoke_forbidden`, inspect token device
  identifier and target path.
- If replay returns `404`, inspect `deviceRevokeChanges` seed and owner ID.

## Packet Prompts

### 01-route-replay

Objective: add `devices/revoke-success.json` to route replay with explicit
stateful replay opt-in and deterministic owner/device seed.
Ownership: `test/compat/fixture-route-replay.test.ts` and
`test/compat/fixture-replay-support.ts`.
Expected output: targeted route replay passes.

### 02-docs-evidence

Objective: update current-state documentation and workflow evidence.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm device revoke fixture is route replayed.
- Confirm replay token subject is `user-id`.
- Confirm default mutating fixture guard still rejects `folders/create`.
- Confirm local checks and CI pass.
