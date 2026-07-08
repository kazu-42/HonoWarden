# Orchestration: Week 26 Linear mutation packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Spark returns usable changes in its owned files, inspect and integrate
  those changes before editing the same files.
- If Spark stalls, close the agent and implement the script/tests locally.
- If any local verification fails, fix the failing slice first, then rerun the
  narrow test before the broad gates.
- If review finds a correctness issue, fix it before PR publication.
- If GitHub merge reports a transient API failure, read back PR and branch state
  before retrying.

## Packet Prompts

- `01-script`: implement `scripts/honowarden-linear-mutation-packet.mjs`.
- `02-tests`: implement `test/ops/linear-mutation-packet.test.ts`.
- `03-docs`: update package script and operator docs after the CLI contract is
  finalized.
- `04-integration`: run gates, local review, PR, CI, merge, and update
  `HANDOFF.local`.

## Completion Audit

- Code is merged to `main`.
- Local `main` is fast-forwarded to `origin/main`.
- `HANDOFF.local` reflects the latest merge and remaining blockers.
- No credentials or local-only files are committed.
