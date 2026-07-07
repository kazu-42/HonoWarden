# Orchestration: Week 26 TOTP Setup Guard

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the enabled-state guard changes initial setup behavior, revert and inspect
  route ordering.
- If a safe TOTP change requires schema support, leave it documented as future
  work instead of overloading setup.

## Packet Prompts

- Test packet: add an app-level test for enabled-account setup reuse.
- Implementation packet: add only an early guard to the setup route.
- Docs packet: explain why change remains unsupported and setup reuse is
  rejected.

## Completion Audit

- TOTP enabled accounts cannot call setup to reset stored factor state.
- Existing setup and verify tests still pass.
- TOTP change route remains listed as not implemented.
