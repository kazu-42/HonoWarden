# Orchestration: Week 26 TOTP Challenge Fixture Replay

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If TOTP challenge replay returns `server_misconfigured`, inspect the seeded
  encrypted secret and `HONOWARDEN_TOTP_SECRET` replay option.
- If replay requires a live TOTP code, stop and split that into the separate
  TOTP login fixture replay workflow.
- If default mutating fixture protection weakens, stop and revise.

## Packet Prompts

### 01-route-replay

Objective: add `token/totp-challenge.json` to route replay with explicit
`allowMutatingFixtures: true` and a TOTP-enabled user seed.
Ownership: `test/compat/fixture-route-replay.test.ts`.
Expected output: targeted route replay passes.

### 02-docs-evidence

Objective: update current-state docs and workflow evidence.
Ownership: `docs/current-state.md` and this workflow directory.
Expected output: final report with verification commands.

## Completion Audit

- Confirm TOTP challenge fixture is route replayed.
- Confirm TOTP login fixture remains documented as future work.
- Confirm default mutating fixture guard still rejects `folders/create`.
- Confirm local checks and CI pass.
