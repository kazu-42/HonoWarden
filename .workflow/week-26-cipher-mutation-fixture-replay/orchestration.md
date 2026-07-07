# Orchestration: Week 26 Cipher Mutation Fixture Replay

## Execution Rules

- Keep the objective to route replay and docs evidence.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If create/update returns `404 cipher_folder_not_found`, inspect folder seed.
- If update conflict does not return `409`, inspect seeded current cipher row and
  `cipherUpdateChanges`.
- If lifecycle fixtures return `404`, inspect the matching cipher mutation count
  seed.

## Packet Prompts

### 01-route-replay

Objective: add cipher create/update/trash/restore/delete and revision-conflict
fixtures to route replay with explicit stateful opt-in and narrow seed support.
Ownership: `test/compat/fixture-route-replay.test.ts` and
`test/compat/fixture-replay-support.ts`.
Expected output: targeted route replay passes.

### 02-docs-evidence

Objective: update current-state documentation and workflow evidence.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm cipher create, update, trash, restore, delete, and conflict fixtures
  are route replayed.
- Confirm default mutating fixture guard still rejects a stateful fixture when
  not opted in.
- Confirm local checks and CI pass.
