# Packet 02: Manifest Docs Evidence

## Objective

Update fixture flow tracking, matrix coverage, documentation, and workflow
evidence for session revoke-all fixture replay.

## Ownership

- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/client-matrix.test.ts`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`
- `.workflow/week-26-session-revoke-fixture-replay/`

## Do

- Add `session_revoke` to manifest and matrix coverage lists.
- Remove the current-state gap for revoke-all fixture replay.
- Record verification commands after they pass.

## Do Not

- Do not claim live client evidence for revoke-all.
- Do not add external compatibility brand names.

## Expected Output

Matrix tests, workflow verification, and full local gates pass.
