Packet ID: 03-docs

Objective: Document the mutation packet command and its live-write boundary.

Ownership:

- `package.json`
- `docs/current-state.md`
- `docs/operations/linear-tracking.md`
- `docs/operations/operator-environment.md`

Do:

- Add `pnpm linear:mutation-packet`.
- Explain that the command consumes a ready apply-plan report and emits a local
  packet only.
- Explain that it is not live-write evidence.
- Keep strict preflight and apply-plan review as prerequisites for future live
  writes.

Do not:

- Do not claim Linear objects were created or updated.
- Do not add credential examples containing real secrets.

Expected output: Operator docs consistent with the command behavior.
