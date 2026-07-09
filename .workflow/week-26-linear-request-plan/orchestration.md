# Orchestration: Week 26 Linear request plan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Linear request plan orchestration

## Sequence

1. Record local-only request-plan scope and constraints.
2. Delegate the simple script/test implementation to Spark with a narrow write
   scope.
3. In parallel, Codex updates docs and package wiring after reviewing the
   expected command name and output contract.
4. Integrate Spark's result, preserving fail-closed behavior from
   `linear:mutation-packet`.
5. Run targeted tests, broad checks, workflow verification, secret scan, and
   `codex review --uncommitted`.
6. Push a PR, wait for CI, merge with `--admin` only after checks pass, then
   update `HANDOFF.local`.

## Branching Rules

- If the request plan needs live API data, block the feature and document the
  missing input instead of adding a weak live dependency.
- If a ready packet contains an unsupported object kind, return `blocked` with
  the unsupported entry instead of omitting it.
- If `mutationSteps` is missing or not an array, return `blocked`.
- If `--strict` is supplied and status is not `ready`, exit non-zero after
  writing the JSON report.

## Packet Prompts

See `packets/01-spark-script-test.md`, `packets/02-docs-integration.md`, and
`packets/03-review.md`.
