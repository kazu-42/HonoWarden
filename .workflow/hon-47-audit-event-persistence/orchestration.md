# Orchestration: HON-47 audit event persistence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If production migration or deploy is required to satisfy acceptance, stop and
  leave Linear open with a blocker comment.
- If local tests prove schema, persistence, sanitization, and retention policy,
  proceed through PR/CI/merge and close Linear.

## Packet Prompts

- Schema/repository: add failing tests for migration shape, required table
  health, insert mapping, and retention deletion; then implement the smallest
  repository and migration.
- App integration: make audit emission awaitable and persist opt-in events while
  preserving existing console JSON-line behavior.
- Retention/docs: update scheduled cleanup and docs so operators know access,
  export, deletion, and retention boundaries.
- Verification: run narrow checks, broad checks, workflow verifier, PR CI, and
  main CI.

## Completion Audit

- PR merged into `main`.
- Main CI passed.
- Linear comment includes tests and any skipped production actions.
