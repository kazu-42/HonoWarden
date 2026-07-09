# Orchestration: HON-41 Backup Export API

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the export route cannot be made owner-scoped with existing repository
  helpers, stop and add a repository helper rather than writing broad SQL in the
  route.
- If recent-auth rejects with anything other than `reauth_required` for refresh
  or stale password tokens, inspect the shared auth helper before changing route
  logic.
- If docs or tests imply production backup/restore is covered by the public API,
  reject that wording and keep the CLI boundary explicit.

## Packet Prompts

- TDD packet: cover recent-auth required, owner-scoped response, omission of
  password hashes/tokens/R2 object keys, and audit event safety.
- Implementation packet: add `POST /api/accounts/export` using
  `authenticateRecentPasswordRequest`, `listFoldersByUser`,
  `listCiphersByUser`, and `listCipherAttachmentsByUser`.
- Docs packet: update backup/restore, audit events, data flow, current state,
  and final report.

## Completion Audit

- HON-41 Linear state/comment reflects PR, merge commit, CI, local checks, and
  explicit non-deploy boundary.
