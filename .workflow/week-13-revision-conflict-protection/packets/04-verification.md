Packet ID: 04-verification
Objective: Prove the integrated slice is ready to push and record CI.
Context: This slice changes update semantics in route and repository layers.
Files / sources: quality commands, workflow files, GitHub Actions.
Ownership: Verification evidence only.
Do: Run local gates, brand scan, workflow verification, push, watch CI, and record the result.
Do not: Deploy, set secrets, or touch production resources.
Expected output: Local checks and CI pass.
Verification: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, workflow verification, brand scan, CI.
