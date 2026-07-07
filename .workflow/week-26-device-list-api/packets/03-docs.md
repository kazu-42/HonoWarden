# Packet 03: Docs

## Objective

Update public project state and security documentation to reflect read-only
device list support without over-claiming metadata mutation support.

## Files

- `docs/current-state.md`
- `docs/compatibility-matrix.md`
- `docs/security/known-limitations.md`
- `docs/security/threat-model.md`
- `docs/security/data-flow.md`
- `docs/release/v0.1.0-alpha-release-notes.md`

## Contract

- Mark `GET /api/devices` and `GET /api/devices/identifier/:identifier` as
  implemented.
- Keep device metadata mutation and trust/key update APIs out of scope.
- Do not introduce external compatibility brand names.

## Verification

- markdown format check
- repository brand scan
