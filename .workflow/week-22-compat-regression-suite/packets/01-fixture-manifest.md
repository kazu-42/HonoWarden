# Packet 01: Fixture Manifest

## Objective

Bind matrix `coveredFlows` claims to fixture files that exist in the repository.

## Scope

- `compat/fixture-flows.json`
- `compat/client-matrix.json`
- `test/compat/client-matrix.test.ts`

## Result

The matrix now includes `sync_with_items`, and CI verifies every declared flow in
the matrix has at least one fixture path in the manifest. Missing fixture files
fail the compatibility test suite.
