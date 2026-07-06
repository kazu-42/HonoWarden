Packet ID: 04-verification
Objective: Prove the integrated compatibility matrix slice is ready to push and record CI.
Context: This slice changes docs and compatibility tests.
Files / sources: quality commands, workflow files, GitHub Actions.
Ownership: Verification evidence only.
Do: Run local gates, brand scan, workflow verification, push, watch CI, and record the result.
Do not: Deploy, set secrets, or run live clients with real data.
Expected output: Local checks and CI pass.
Verification: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, workflow verification, brand scan, CI.
