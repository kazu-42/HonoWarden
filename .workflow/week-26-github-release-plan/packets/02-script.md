# Packet 02: Script

## Objective

Implement read-only GitHub release planning.

## Contract

- Do not create, update, publish, or delete a GitHub release.
- Do not create or push a Git tag.
- Emit a draft prerelease command with `--verify-tag`.
- Support pre-tag planning through explicit missing-tag allowances.
