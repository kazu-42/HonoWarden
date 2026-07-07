# Orchestration: Week 26 Release Approval Packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the strict release gate fails, stop and fix gate evidence before asking for
  tag approval.
- If the remote tag already exists, stop; do not create, delete, or replace tags
  without a separate corrective approval.
- If CI evidence is missing or for a different commit, keep the packet
  `not_ready` unless the caller explicitly uses a local-only dry-run flag.
- If a remote-specific check prints a push command for a different remote, fix
  the command contract before proceeding.
- Do not run tag creation, tag push, GitHub release creation, GitHub release
  publication, DNS, email, or deployment commands in this workflow.

## Packet Prompts

- CLI contract: add a read-only packet script and package command that compose
  the release gate, tag preflight, GitHub release plan, CI evidence, and
  approval text.
- Tests: prove the packet is ready with a disposable remote, fails strict mode
  without CI evidence, and keeps remote-aware tag commands aligned.
- Docs: update the tagging runbook and current-state docs with the approval
  packet boundary.
- Verification: run focused tests, broad local checks, brand scan, workflow
  verifier, push, and GitHub Actions CI.

## Completion Audit

- Confirm the packet reports `status: "ready"` with CI evidence on a clean
  commit.
- Confirm no local or remote `v0.1.0-alpha` tag exists unless the operator later
  approves creation.
- Confirm no GitHub release was created or published.
- Confirm the final CI run passed on the pushed commit.
- Confirm the final response repeats the exact approval text instead of running
  it.
