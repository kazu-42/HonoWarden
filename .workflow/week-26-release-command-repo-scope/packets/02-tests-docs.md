# Packet 02: Tests And Docs

## Objective

Update tests and docs for repo-scoped release commands.

## Context

Several release packets pass command strings through from the GitHub release
plan. Tests should assert the safer command shape.

## Files / Sources

- `test/ops/*.test.ts`
- `docs/current-state.md`
- `.workflow/week-26-release-command-repo-scope/`

## Ownership

Main agent.

## Do

- Update command expectations.
- Document repo-scoped commands in current state.

## Do Not

- Claim release publication has happened.

## Expected Output

Tests fail if repo scope is removed from emitted release commands.

## Verification

Focused release packet tests.
