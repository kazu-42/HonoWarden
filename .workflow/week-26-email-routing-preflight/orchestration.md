# Orchestration: Week 26 Email Routing Preflight

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If exact Cloudflare API permission names are uncertain, document them as
  required capability categories and keep the script offline.
- If a destination value is present, report only configured/missing status and
  the env var name, never the value.
- If strict mode fails during tests, assert stderr/stdout without exposing
  secrets.

## Packet Prompts

- Script packet: implement a deterministic local report from environment
  variables.
- Test packet: execute the CLI with controlled env and assert redaction.
- Docs packet: update email/operator runbooks and current state.

## Completion Audit

- Preflight cannot leak configured token or destination values.
- Default command is safe for CI and local use without secrets.
- Strict mode is available for operator readiness checks.
