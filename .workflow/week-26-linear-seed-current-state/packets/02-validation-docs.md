# Packet 02: Validation And Docs

Objective: Enforce and document the updated Linear seed state model.

Files:

- `scripts/honowarden-linear-seed.mjs`
- `test/ops/linear-seed.test.ts`
- `docs/current-state.md`
- `docs/operations/linear-tracking.md`

Do:

- Validate issue `stateType` values.
- Report issue state counts from `pnpm linear:seed`.
- Cover invalid state values in tests.
- Update docs with the new view and state counts.

Do not:

- Implement live Linear apply.
- Relax workspace access guards.

Expected output: Local validation fails on malformed issue states and docs match
the seed.

Verification: targeted Linear seed tests plus broader checks before merge.
