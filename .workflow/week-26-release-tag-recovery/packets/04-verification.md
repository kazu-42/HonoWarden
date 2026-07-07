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
