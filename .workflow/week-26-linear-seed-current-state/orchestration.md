# Orchestration: Week 26 Linear Seed Current State

## Sequence

1. Read current release, ops readiness, and Linear seed state.
2. Add a seed-level state model using Linear state types.
3. Update Pulse and views to reflect the published alpha and remaining ops
   risks.
4. Extend validation and tests so future seed edits cannot omit issue state.
5. Update docs and workflow evidence.
6. Run local verification before PR.

## Branching Rules

- If a live Linear connector or API token points at a workspace other than
  `honowarden`, do not write to Linear.
- If a task has only fixture evidence or partial ops evidence, do not mark it as
  completed unless its issue acceptance criteria are still satisfied by the
  recorded evidence.
- If validation fails, fix the seed or schema before updating docs.

## Packet Prompts

### 01-seed-state

Update `ops/linear/honowarden.seed.json` to represent the current
post-publication state. Use `stateType`, not workspace-specific state names.
Keep remaining live Email Routing, official-client expansion, and TOTP change
management work visible.

### 02-validation-docs

Update `scripts/honowarden-linear-seed.mjs`, tests, and docs so the new seed
state model is enforced and explained.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
