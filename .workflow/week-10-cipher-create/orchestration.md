# Orchestration: Week 10 Cipher Create

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If cipher create can write into a folder not owned by the user, stop before route integration.
- If response merging allows request `id` or `userId` to override stored metadata, reject the implementation.
- If local full checks fail, do not push.

## Packet Prompts

- `01-cipher-repository`: implement list/create repository functions for ciphers.
- `02-folder-ownership`: implement and test active folder ownership check.
- `03-cipher-route-sync`: implement `POST /api/ciphers` and sync ciphers.
- `04-verification`: run full local verification, push, and watch CI.

## Completion Audit

- Packet 01: complete.
- Packet 02: complete.
- Packet 03: complete.
- Packet 04: local verification complete, CI pending push.
