# Packet 01: Tests

## Objective

Define the GitHub release planning command contract before implementation.

## Contract

- The script prints schema version `1`.
- The report targets `v0.1.0-alpha` and `0.1.0-alpha`.
- The report validates package version, release notes, local tag context, and
  optional remote tag context.
- The report includes a draft `gh release create` command.
- Strict mode exits non-zero while still printing JSON when a check fails.
