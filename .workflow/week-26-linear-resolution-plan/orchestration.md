# Orchestration: Week 26 Linear resolution plan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Linear resolution plan orchestration

## Sequence

1. Define the local-only resolution map contract.
2. Delegate bounded script/test work to Spark.
3. In parallel, Codex wires docs/package/workflow artifacts.
4. Integrate and harden resolver behavior against ready, blocked, and malformed
   inputs.
5. Run targeted checks, broad checks, workflow verification, secret scan, and
   `codex review --uncommitted`.
6. Push PR, wait for CI, merge with `--admin`, sync main, update
   `HANDOFF.local`.

## Branching Rules

- If request plan status is not ready, output blocked and no resolved steps.
- If resolution map is missing, output blocked and list no resolved steps.
- If required IDs are missing, output blocked with missing IDs grouped by step.
- If all required IDs are present, output ready with resolved request steps.
- Never call external APIs or infer fake IDs.

## Packet Prompts

See `packets/01-spark-script-test.md`, `packets/02-docs-integration.md`, and
`packets/03-review.md`.
