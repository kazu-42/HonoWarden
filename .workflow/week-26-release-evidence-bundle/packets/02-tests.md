# Packet 02: Tests

## Objective

Prove the evidence bundle is read-only and rejects incomplete approval evidence.

## Files

- `test/ops/release-evidence-bundle.test.ts`
- `test/release-docs.test.ts`

## Do

- Use disposable remotes.
- Use a fake `gh` binary for CI run and release-view evidence.
- Assert ready bundle output.
- Assert explicit local output writing.
- Assert strict mode fails without CI evidence.

## Do Not

- Create real tags.
- Create, update, publish, or delete GitHub releases.
- Depend on live GitHub in focused tests.

## Expected Output

Focused tests cover the bundle's ready, output, and missing-CI failure paths.
