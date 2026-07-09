# Packet: Docs And Verification

Objective: document the user export API, its operational boundaries, and the
remaining HON-41 risks.

Files:

- `docs/current-state.md`
- `docs/operations/backup-restore.md`
- `docs/operations/audit-events.md`
- `docs/security/data-flow.md`
- `docs/security/known-limitations.md`
- `docs/security/threat-model.md`
- `docs/release/v0.1.0-alpha-release-notes.md`

Do:

- keep user export separate from operator disaster-recovery backup/restore
- document rate-limit, audit, failure, retry, and no-deploy boundaries
- record local verification evidence

Do not:

- claim live official-client export evidence
- claim export-specific global quota or abuse monitoring
- claim Worker deploy or production smoke
