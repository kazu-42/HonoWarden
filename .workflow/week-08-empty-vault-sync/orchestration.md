# Orchestration: Week 8 Empty Vault Sync

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If access-token verification fails open, stop and fix token validation before route work.
- If repository lookup by ID cannot reuse the auth user record shape, update the mapper once rather than duplicating response DTO logic.
- If the sync route cannot prove the user is active and security-stamp-current, return `401 invalid_token`.
- If local full checks fail, do not push.

## Packet Prompts

- `01-token-verification`: implement and test compact HMAC access-token verification.
- `02-sync-repository`: implement and test `findAuthUserById`.
- `03-sync-route`: implement and test authenticated `GET /api/sync`.
- `04-verification`: run full local verification, smoke, workflow verification, push, and watch CI.

## Completion Audit

- Packet 01: complete.
- Packet 02: complete.
- Packet 03: complete.
- Packet 04: local checks complete, CI pending push.
