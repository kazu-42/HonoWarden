# Packet 02: Docs and integration

## Objective

Wire `linear:request-plan` into package scripts and operator docs.

## Ownership

Codex owns:

- `package.json`
- `docs/current-state.md`
- `docs/operations/linear-tracking.md`
- `docs/operations/operator-environment.md`
- `.workflow/week-26-linear-request-plan/**`

## Required Behavior

- Add `pnpm linear:request-plan`.
- Document that the request plan is local-only and not execution evidence.
- Show the strict command chain after `linear:mutation-packet`.
- Preserve the remaining live-write boundary.

## Verification

Run targeted script/test checks after Spark integration.
