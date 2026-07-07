# Orchestration: Week 26 Operator Env Guard

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If tests reveal tracked secret-looking assignments, remove them from tracked
  files and move placeholders into `.env.example`.
- If direnv syntax is uncertain, prefer simple built-in directives already
  documented by direnv.
- If an external API key is needed, stop and ask instead of probing services.

## Packet Prompts

- Test packet: inspect `.envrc`, `.env.example`, `.gitignore`, and operator
  docs without reading local ignored secret files.
- Config packet: add only safe, non-secret direnv directives.
- Docs packet: document validation and current blockers without secrets.

## Completion Audit

- Operator env policy is covered by tests.
- No real secret values or new external writes were introduced.
