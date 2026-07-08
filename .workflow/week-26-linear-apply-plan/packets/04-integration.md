Packet ID: 04-integration
Objective: Integrate, verify, review, publish, and merge the slice.
Ownership: final command execution and PR handling.
Do:

- Review Spark output before accepting.
- Run targeted tests and repo gates.
- Run local review before merge.
- Update `HANDOFF.local` after a successful merge or at a clean stopping point.
  Do not:
- Force-delete local branches unless explicitly needed.
  Expected output: merged PR or a precise blocker.
  Verification: GitHub PR/CI readback.
