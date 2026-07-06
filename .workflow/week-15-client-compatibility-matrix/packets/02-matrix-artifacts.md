Packet ID: 02-matrix-artifacts
Objective: Add structured and human-readable compatibility matrix artifacts.
Context: The repo has fixtures but no exact client-version matrix.
Files / sources: `compat/client-matrix.json`, `docs/compatibility-matrix.md`, `specs/week-15-client-compatibility-matrix.md`.
Ownership: Compatibility documentation artifacts.
Do: Mark rows `fixture_only`, list known issues, and keep promotion rules strict.
Do not: Claim live compatibility or store secrets, personal data, direct source URLs, or broad version ranges.
Expected output: Matrix documents exact versions and current limitations.
Verification: `pnpm compat:test` and repository brand scan.
