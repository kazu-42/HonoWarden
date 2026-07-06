Packet ID: 03-matrix-validation
Objective: Add CI validation for matrix completeness and precision.
Context: Compatibility docs can drift unless a test enforces required rows and fields.
Files / sources: `test/compat/client-matrix.test.ts`.
Ownership: Compatibility matrix tests.
Do: Validate required surfaces, exact version shape, release timestamps, mobile builds, known issues, verification level, and covered flows.
Do not: Overfit to one transient release source beyond the recorded exact values.
Expected output: `pnpm compat:test` fails on incomplete or vague matrix rows.
Verification: `pnpm compat:test`.
