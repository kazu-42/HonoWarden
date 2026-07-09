# Orchestration

Packet sequence:

1. Implementation packet
   - Add stateful FakeD1 bootstrap support.
   - Add synthetic app-level dogfood lifecycle test.
   - Add reusable dogfood evidence packet CLI.

2. Documentation packet
   - Add release evidence document.
   - Link the evidence from release index, dogfood runbook, release notes, and
     current-state.
   - Add the evidence document to release gate required docs.

3. Verification packet
   - Run focused tests first.
   - Run repo-wide checks after formatting.
   - Update Linear and PR with residual production boundary.

Branching rules:

- If the app-level test needs production credentials or real client binaries,
  stop and convert HON-61 to blocked instead of weakening evidence.
- If release gate fails because the new evidence doc is not substantive, update
  the doc rather than removing the gate.
- If HON-24 SMTP evidence arrives while this branch is in progress, finish the
  current safe local validation first, then return to HON-24 closeout.
