Packet ID: 03-verification

Objective: Verify placeholders are safe and do not unblock ops readiness.

Do:

- Run focused docs and ops packet tests.
- Run the ops readiness packet and confirm `not_ready`.
- Run broad local checks and CI readback.

Do not:

- Perform release publication, deploy, DNS, email, or secret writes.
