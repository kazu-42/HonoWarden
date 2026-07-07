Packet ID: 03-docs-workflow
Objective: Make the recovery path discoverable in release docs and workflow state.
Files / sources: docs/release/tagging-runbook.md, docs/current-state.md,
test/release-docs.test.ts, .workflow/week-26-release-tag-recovery/**
Ownership: docs/workflow

Do:

- Document the recovery packet in the failure-handling path.
- Keep tag movement explicitly approval-gated.
- Record current state without claiming the tag has already been moved.

Do not:

- Replace the operator approval requirement with documentation alone.

Expected output:

- Release docs mention the recovery packet and force-with-lease boundary.

Verification:

- pnpm exec vitest run test/release-docs.test.ts
  *** Add File: .workflow/week-26-release-tag-recovery/packets/04-verification.md
  Packet ID: 04-verification
  Objective: Verify the recovery packet slice and leave a clear external-write gate.
  Files / sources: all changed files
  Ownership: verification

Do:

- Run focused tests and full local checks.
- Run release gate and repository brand scan.
- Verify the workflow artifact.
- Push to main and require green CI before tag movement approval.

Do not:

- Move the tag before explicit operator approval.

Expected output:

- Local verification evidence and CI run ID.

Verification:

- pnpm check
- pnpm lint
- pnpm test
- pnpm format
- pnpm release:gate -- --strict
- repository brand scan
