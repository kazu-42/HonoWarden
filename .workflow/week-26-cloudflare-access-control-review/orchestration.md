# Orchestration: Week 26 Cloudflare Access-Control Review

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If readback contains sensitive values, redact to counts/hash tags before
  writing any tracked file.
- If a remediation requires Cloudflare mutation, defer it to `HON-64` or
  `HON-60` instead of expanding HON-58.
- If tests require old `HON-58` gaps, update the invariant to point to the
  active follow-up issue only when the review is actually documented.

## Packet Prompts

- `01-review-docs`: Implement the redacted review doc, link it from operator and
  security docs, update release/current-state wording, add tests that reject
  secret-like values, then run local verification.

## Completion Audit

- Confirm HON-58 can be closed as "review documented".
- Confirm remediation remains visible through `HON-64` and known limitations.
- Confirm no Cloudflare mutation was performed by this workflow.
