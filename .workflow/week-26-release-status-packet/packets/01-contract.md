# Packet 01: Contract

## Objective

Define the release status packet output contract with focused tests.

## Context

Operators need one read-only JSON report that summarizes whether the release is
ready for publication, already verified after publication, or blocked.

## Files / Sources

- `test/ops/release-status-packet.test.ts`
- `scripts/honowarden-release-status-packet.mjs`

## Ownership

Main agent.

## Do

- Cover draft-ready status.
- Cover published-verified status.
- Cover strict not-ready behavior when publication evidence is missing.
- Assert approval text and commands are scoped to the current phase.

## Do Not

- Publish a release.
- Require network access in unit tests.

## Expected Output

Focused tests that exercise the status script through fake `git` and `gh`
commands.

## Verification

`pnpm exec vitest run test/ops/release-status-packet.test.ts`
