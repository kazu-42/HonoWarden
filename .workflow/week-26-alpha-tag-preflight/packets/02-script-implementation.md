# Packet 02: Script Implementation

## Objective

Implement the read-only tag preflight script.

## Contract

- No Git tag is created.
- No Git tag is pushed.
- No remote service is mutated.
- Development-only flags can allow dirty working tree or existing local tag for
  testability, but normal strict mode remains conservative.
- The emitted commands are operator instructions, not executed actions.
