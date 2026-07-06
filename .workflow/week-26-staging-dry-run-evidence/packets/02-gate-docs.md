# Packet 02: Gate And Docs

Objective: Tighten release gate checks and update operator-facing docs.

Files / sources:

- `scripts/honowarden-release-gate.mjs`
- `docs/operations/backup-restore.md`
- future `docs/release/staging-deploy-evidence.md`
- release docs tests

Do:

- Require substantive staging evidence fields.
- Keep the gate blocked until those fields exist.
- Correct backup/restore pnpm argument examples that pass a literal separator to
  the wrapper.

Do not:

- Make release gate ready while live-client or Cloudflare resource evidence is
  still absent.

Verification:

- Release gate remains `not_ready` before staging evidence is recorded.
