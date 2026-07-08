# Orchestration: Week 26 default tag workflow evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If committed workflow state is missing or invalid, leave options unchanged and
  keep existing strict failure behavior.
- If explicit tag workflow args are supplied, do not overwrite them.
- If the default run does not pass `gh run view` validation, report the packet as
  not ready.
- If an implementation path requires publishing, deploying, tag mutation, DNS,
  Email Routing, email sending, or secret writes, stop and reject it.

## Packet Prompts

- `01-helper`: create a small dependency-free helper that reads
  `.workflow/week-26-release-tag-recovery/state.json` and fills only missing
  tag workflow evidence fields.
- `02-integration`: import the helper in read-only release/ops packets, add
  `--no-default-tag-workflow-evidence`, and update tests.
- `03-docs-workflow`: update release/ops docs and this workflow artifact.
- `04-verification`: run local checks, review, PR CI, and main CI readback.

## Completion Audit

- Default readbacks without tag workflow args report the draft release as ready
  for publication approval.
- Strict missing-evidence tests still fail when
  `--no-default-tag-workflow-evidence` is supplied.
- No external write is performed.
