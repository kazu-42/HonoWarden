# Orchestration: Week 26 Post Tag Release Packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the local tag is missing in strict mode, stop; do not create it here.
- If the remote tag is missing in strict mode, stop; do not push it here.
- If local and remote tag commits disagree, treat it as an incident candidate
  and do not create a release draft.
- If the tag verification workflow is missing, pending, failed, skipped, for a
  different workflow, or for a different commit, keep the packet `not_ready`.
- If an existing release is published or not a draft prerelease for the target
  tag, do not create or publish anything.
- Do not run tag creation, tag push, release creation, release publication,
  deploy, DNS, or email routing commands in this workflow.

## Packet Prompts

- CLI contract: add a read-only packet script and package command that compose
  tag context, workflow evidence, release planning, release state, commands, and
  draft approval text.
- Tests: use fake `git` and `gh` binaries to model pushed annotated tags,
  missing workflow evidence, and wrong remote tag SHAs without mutating the real
  repository or GitHub.
- Docs: update the tagging runbook and current-state docs with the post-tag
  packet boundary.
- Verification: run focused tests, broad checks, brand scan, workflow verifier,
  push, and GitHub Actions CI.

## Completion Audit

- Confirm `pnpm release:post-tag:packet` exists and is read-only.
- Confirm strict mode requires tag workflow evidence.
- Confirm remote annotated tags are compared by peeled commit SHA.
- Confirm no tag, GitHub release, DNS, email, or deployment write happened.
- Confirm final CI passes on the pushed commit.
