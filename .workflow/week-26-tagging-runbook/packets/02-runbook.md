# Packet 02: Runbook

## Objective

Document the tag operation without performing it.

## Contract

- Preconditions include clean working tree, release gate, tag preflight, CI,
  local tag absence, and brand scan.
- The approval gate is explicit.
- Commands are documented as operator steps only.
- Failure handling distinguishes local cleanup from pushed-tag incidents.
