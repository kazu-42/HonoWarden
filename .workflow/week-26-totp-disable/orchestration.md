# Orchestration: Week 26 TOTP Disable

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If repository tests fail for a reason other than the expected missing
  function, inspect the fake D1 helper before implementing.
- If route shape is ambiguous, prefer a minimal authenticated account endpoint
  that does not expose secret material.
- If audit metadata would need secret or code data, omit metadata instead.
- If any full verification fails, fix or revert only the slice-local change that
  caused it.

## Packet Prompts

- Repository packet: implement a single owner-scoped `disableTotpSetup`
  operation that clears TOTP secret material and replay state only when enabled.
- Route packet: expose the operation behind recent password auth, return stable
  JSON, and preserve fail-closed database behavior.
- Docs packet: update current state, auth state machine, data flow, audit event
  inventory, and release notes.
- Verification packet: run narrow-to-broad checks and record exact evidence.

## Completion Audit

- Repository tests prove enabled-only update and clear retained state.
- HTTP tests prove success, recent-auth rejection, and audit behavior.
- Docs no longer list TOTP disable route as unimplemented.
- Full local verification passes before commit.
