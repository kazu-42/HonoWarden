# Week 22 Orchestration

## Goal

Make compatibility claims mechanically traceable to fixture files.

## Sequence

1. Inspect current response builders and existing app tests for alpha-critical
   protocol shapes.
2. Add fixture-flow manifest and strengthen compatibility tests.
3. Add synthetic fixtures for all currently declared matrix flows.
4. Update compatibility docs and current-state notes.
5. Run narrow compatibility tests, then full local gates and brand scans.
6. Push, wait for CI, and record evidence.

## Packets

### 01-fixture-manifest

Owns `compat/fixture-flows.json` and `test/compat/client-matrix.test.ts`.
Ensure every matrix covered flow has at least one existing fixture path.

### 02-alpha-critical-fixtures

Owns `compat/fixtures/**` and `test/compat/compat-fixtures.test.ts`.
Add compact fixtures and array-index JSON path support.

### 03-docs-verification

Owns `compat/README.md`, `docs/compatibility-matrix.md`,
`docs/current-state.md`, and workflow final evidence.

## Sidecar QA

A Spark xhigh explorer reviews fixture scope and harness risks while the main
thread implements non-overlapping changes.

## Verification Policy

Fail the workflow if a matrix flow lacks fixture coverage, a fixture assertion
cannot be evaluated, a brand scan finds a forbidden tracked string, or CI fails.
