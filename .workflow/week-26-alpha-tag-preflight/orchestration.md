# Orchestration: Week 26 Alpha Tag Preflight

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If focused tests fail because the script is missing, implement the script
  rather than weakening the tests.
- If strict release gate fails, stop tag-readiness work and fix the underlying
  release evidence first.
- If the working tree is dirty, use `--allow-dirty` only for local development
  checks. The final strict preflight must run clean.
- If a local tag already exists, do not retag automatically. Require explicit
  operator review.
- If remote tag absence must be proven, add a separate explicit approval-gated
  check; do not fold remote mutation into this local preflight.

## Packet Prompts

- Contract and tests: specify the JSON report and strict failure behavior.
- Script implementation: implement local read-only checks and command output.
- Docs and scripts: expose the npm command and document limits.
- Verification: run local checks and record CI after push.

## Completion Audit

- Confirm no tag was created locally.
- Confirm no tag was pushed.
- Confirm all verification commands passed.
- Confirm CI passed on the commit containing the preflight.
- Confirm final operator action remains approval-gated.
