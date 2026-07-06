# Packet 02: Access Guard

## Objective

Document safe apply rules before any live Linear mutation.

## Scope

- `docs/operations/linear-tracking.md`
- `docs/current-state.md`

## Tasks

- Record the current connector and browser access state.
- Document that live writes require a confirmed `honowarden` workspace session.
- Keep the seed as the source of truth until live access is available.

## Acceptance

- Docs clearly prevent creating HonoWarden resources in an unrelated workspace.
- Current state distinguishes local seed readiness from live Linear setup.
