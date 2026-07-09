# Orchestration: Week 26 Formal secret rotation dry-run

## Sequence

1. Confirm the task boundary: formal dry-run only, no real credential rotation.
2. Add a non-mutating CLI that produces a redacted credential-class packet.
3. Add tests that prove the packet is ready, complete, writeable to an evidence
   path, and secret-safe.
4. Update security, operations, release, and current-state docs so dry-run
   completion is not confused with live rotation.
5. Run local verification from narrow tests to full suite.
6. Publish PR, wait for CI, merge, wait for main CI, and update Linear.

## Branch Rules

- If any command requires live mutation, stop and record it as a future live
  rotation-window step.
- If output includes a secret value or private destination, treat it as a
  blocker and redesign the packet.
- If docs imply production readiness or live rotation, revise before PR.

## Packets

- `01-cli.md`: local dry-run CLI and package script.
- `02-docs.md`: runbook, release evidence, current-state, and security docs.
- `03-tests.md`: CLI contract tests and docs boundary tests.
- `04-closeout.md`: verification, PR, CI, merge, and Linear closeout.
