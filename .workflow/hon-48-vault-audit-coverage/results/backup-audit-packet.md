# Result: Backup Audit Packet

Accepted.

- Backup CLI stdout now includes a secret-safe `audit` packet for export and
  restore.
- The packet contains action name, success outcome, planned/executed result
  status, and `sha256:<manifest-hash>` only.

Boundary.

- This is local operator evidence, not a persisted Worker audit event.
- No live backup or restore command was executed.
