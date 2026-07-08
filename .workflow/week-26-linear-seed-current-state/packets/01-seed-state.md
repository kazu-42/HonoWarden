# Packet 01: Seed State

Objective: Update the Linear seed with current issue states, Pulse text, and a
completed-release evidence view.

Files:

- `ops/linear/honowarden.seed.json`
- `docs/current-state.md`
- `docs/operations/linear-tracking.md`

Do:

- Add issue `stateType` values using Linear state types.
- Keep incomplete live Email Routing and broader live-client evidence visible.
- Replace stale Pulse text that said the final tag/release was not cut.

Do not:

- Write to Linear.
- Add workspace-specific state ids.
- Store secrets or mailbox destinations.

Expected output: A seed that reflects published alpha state and remaining ops
risk.

Verification: `pnpm linear:seed`.
