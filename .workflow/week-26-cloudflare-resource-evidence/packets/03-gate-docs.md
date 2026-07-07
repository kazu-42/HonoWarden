# Packet 03: Gate And Docs

Objective: Record release evidence and update release gate checks.

Do:

- Add `docs/release/cloudflare-resource-evidence.md`.
- Require resource evidence fields and non-placeholder D1 IDs in the release
  gate.
- Update release docs and current-state notes.

Do not:

- Claim Worker deploy, route writes, secrets, or live HTTP smoke.

Verification:

- `pnpm release:gate`
- release docs tests
