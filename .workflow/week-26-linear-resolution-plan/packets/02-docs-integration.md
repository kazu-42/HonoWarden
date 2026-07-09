# Packet 02: Docs and integration

## Objective

Wire `linear:resolution-plan` into package scripts and operator docs.

## Ownership

Codex owns:

- `package.json`
- `docs/current-state.md`
- `docs/operations/linear-tracking.md`
- `docs/operations/operator-environment.md`
- `.workflow/week-26-linear-resolution-plan/**`

## Required Behavior

- Add `pnpm linear:resolution-plan`.
- Document that the resolution plan is local-only and still not execution
  evidence.
- Show the strict command chain after `linear:request-plan`.
- Preserve the live-write boundary.

## Verification

Run targeted checks after Spark integration.
