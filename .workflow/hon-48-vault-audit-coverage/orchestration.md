# Orchestration: HON-48 vault audit coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If backup operator audit requires live backup execution, stop and document the
  boundary. Do not execute production backups in this issue.
- If route audit coverage can be proven locally without secrets, proceed to PR.

## Packet Prompts

- Route audit coverage: add Red tests for folder/cipher/attachment audit events
  and implement helper functions in `src/app.ts`.
- Backup audit packet: add Red tests for export/restore stdout audit packet and
  implement in `scripts/honowarden-backup.mjs`.
- Docs/workflow: update docs and workflow evidence after code is green.

## Completion Audit

- PR CI and main CI passed.
- Linear Done comment records verification and remaining boundaries.
