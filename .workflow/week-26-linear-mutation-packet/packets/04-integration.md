Packet ID: 04-integration

Objective: Integrate, verify, review, publish, merge, and update handoff.

Ownership: final repository state.

Do:

- Inspect Spark changes before accepting.
- Run targeted and broad checks.
- Run local `codex review --uncommitted`.
- Create PR, watch CI, merge with `--admin` if checks pass.
- Fast-forward local `main`.
- Update ignored `HANDOFF.local`.

Do not:

- Do not force-delete local squash-merged branches unless explicitly asked.
- Do not commit local-only files or credentials.

Expected output: Merged PR and updated local handoff.
