Packet ID: 04-verification
Objective: Prove the integrated device revoke slice is ready to push and record CI.
Context: This slice changes auth context, route behavior, and auth repository writes.
Files / sources: quality commands, workflow files, GitHub Actions.
Ownership: Verification evidence only.
Do: Run local gates, brand scan, workflow verification, push, watch CI, and record the result.
Do not: Deploy, set secrets, or touch production resources.
Expected output: Local checks and CI pass.
Verification: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, workflow verification, brand scan, CI.
