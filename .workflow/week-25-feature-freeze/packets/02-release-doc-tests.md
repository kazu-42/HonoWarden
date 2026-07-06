# Packet 02: Release Doc Tests

## Objective

Make release documents and migration freeze hashes CI-visible.

## Scope

- `test/release-docs.test.ts`

## Result

Added a Vitest test that checks required release docs, compares migration
SHA-256 hashes against `docs/release/migration-freeze.md`, and verifies alpha
exclusions remain explicit.
