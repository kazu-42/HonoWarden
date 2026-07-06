Packet ID: 03-refresh-coverage-docs
Objective: Prove revoked-device refresh behavior and record docs.
Context: Refresh grant already rejects sessions whose joined device row has `revoked_at`.
Files / sources: `test/app.test.ts`, `specs/week-14-device-revoke.md`, `docs/current-state.md`, workflow files.
Ownership: Coverage and documentation.
Do: Add revoked-device refresh test and update current-state/spec docs.
Do not: Add broader device list or metadata update APIs.
Expected output: Docs match tested behavior.
Verification: targeted app tests and workflow verification.
