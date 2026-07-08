# Orchestration: Week 26 Linear apply plan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Linear apply plan orchestration

## Goal

Create a safe local apply-plan layer for the Linear seed after the read-only
preflight guard, without performing live mutations.

## Sequence

1. Confirm local environment state without printing secrets.
2. Delegate the bounded implementation packet to Spark.
3. Update docs and workflow artifacts locally.
4. Integrate Spark output and review the resulting JSON contract.
5. Run targeted tests and the repo gate set.
6. If review and CI are clean, publish through PR and merge.

## Branching Rules

- If `LINEAR_API_KEY` is missing, do not attempt live Linear writes.
- If the apply-plan command reads credentials or calls the network, reject the
  implementation.
- If a ready preflight report is supplied, classify only inventory-backed
  object types as create/confirm-existing; keep unresolved object types as
  create-or-update or manual-confirm.
- If strict mode is blocked, exit non-zero.

## Packets

- `01-script`: Spark-owned implementation of the command and package script.
- `02-tests`: Spark-owned tests for the command contract.
- `03-docs`: local docs updates for the operator flow.
- `04-integration`: local verification, review, PR, and merge.
