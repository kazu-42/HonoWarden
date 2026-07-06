# Orchestration: Week 9 Folder CRUD

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If protected-route auth diverges from sync auth, extract a shared helper before adding folder writes.
- If repository tests cannot prove owner scoping, stop before route integration.
- If delete requires hard deletion, reject that path and keep soft delete for rollback safety.
- If local full checks fail, do not push.

## Packet Prompts

- `01-folder-repository`: implement folder repository and tests.
- `02-auth-helper`: refactor authenticated user loading without changing Week 8 behavior.
- `03-folder-routes`: implement create/update/delete routes and sync folder inclusion.
- `04-verification`: run full local verification, push, and watch CI.

## Completion Audit

- Packet 01: complete.
- Packet 02: complete.
- Packet 03: complete.
- Packet 04: local verification complete, CI pending push.
