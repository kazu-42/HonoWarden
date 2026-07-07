Packet ID: 01-evidence-docs

Objective: Add conservative post-alpha operations evidence files.

Files:

- `docs/release/worker-live-smoke-evidence.md`
- `docs/release/website-live-evidence.md`
- `docs/release/email-routing-evidence.md`
- `docs/release/ops-rollback-evidence.md`

Do:

- Use `Status: not_performed`.
- Include required approval, evidence fields, smoke or rollback commands, and
  not-performed statements.
- Avoid secrets, private forwarding destinations, message bodies, and real vault
  data.

Do not:

- Claim live deploy, DNS, email routing, smoke, or rollback proof.
