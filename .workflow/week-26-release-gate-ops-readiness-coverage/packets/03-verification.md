Packet ID: 03-verification

Objective: Verify release gate readiness and CI after integration.

Owner: main agent.

Do:

- Run focused release gate tests.
- Run strict release gate and broad local checks.
- Run read-only release status and ops readiness packets.
- Push and read back GitHub Actions CI.

Do not:

- Publish the release or perform deploy/DNS/email writes.
