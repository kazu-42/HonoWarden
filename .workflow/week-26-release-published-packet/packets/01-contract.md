# Packet 01: Contract

## Objective

Define the post-publication packet output contract with focused tests.

## Context

The release currently exists as a draft prerelease. The post-publication packet
must only report ready after the release is published and remains a prerelease.

## Files / Sources

- `test/ops/release-published-packet.test.ts`
- `scripts/honowarden-release-published-packet.mjs`

## Ownership

Main agent.

## Do

- Cover published prerelease success.
- Cover blocking while the release is still a draft.
- Cover strict failure without tag workflow evidence.
- Assert that no mutation or deployment command is emitted.

## Do Not

- Run a real publication command.
- Require network access in unit tests.

## Expected Output

Focused tests that exercise the script through fake `git` and `gh` commands.

## Verification

`pnpm exec vitest run test/ops/release-published-packet.test.ts`
