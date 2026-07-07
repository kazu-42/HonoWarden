# Orchestration: Week 26 Release Evidence Bundle

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the bundle is `not_ready`, inspect child evidence before changing bundle
  logic.
- If CI evidence is missing or stale, do not emit approval text.
- If `--output` points to an existing file and `--overwrite` is absent, fail
  instead of replacing prior evidence.
- Do not run tag creation, tag push, release draft creation, release
  publication, deploy, DNS, or email routing commands.

## Packet Prompts

- CLI contract: add a read-only evidence bundle command that composes release
  gate, tag preflight, approval packet, post-tag preview, brand scan, commands,
  limitations, and approval text.
- Tests: use fake `gh` and disposable remotes to cover ready evidence, local
  output writing, and strict failure without CI evidence.
- Docs: update the tagging runbook and current-state docs with the bundle as
  the pre-approval evidence artifact.
- Verification: run focused tests, broad checks, brand scan, workflow verifier,
  push, and CI.

## Completion Audit

- Confirm the bundle reports `ready` with real CI evidence for the current
  commit after push.
- Confirm approval text is null when required evidence is missing.
- Confirm no tag, release, deploy, DNS, or email write happened.
- Confirm generated local evidence output requires an explicit path.
- Confirm CI passed on the final commit.
