# Packet 01: CLI Contract

## Objective

Define the release publish packet output contract with focused tests.

## Context

The `v0.1.0-alpha` release draft exists after tag verification. Publishing is a
separate external write and must not happen from tests or packet generation.

## Files / Sources

- `test/ops/release-publish-packet.test.ts`
- `scripts/honowarden-release-publish-packet.mjs`
- `test/release-docs.test.ts`

## Ownership

Main agent.

## Do

- Cover ready output for a draft prerelease on the target commit.
- Cover blocking when the release is already not a draft.
- Cover strict failure without tag workflow evidence.
- Assert the emitted publish command and approval text.

## Do Not

- Run any real `gh release edit` command.
- Require network access in unit tests.

## Expected Output

Focused tests that exercise the script through fake `git` and `gh` commands.

## Verification

`pnpm exec vitest run test/ops/release-publish-packet.test.ts`
