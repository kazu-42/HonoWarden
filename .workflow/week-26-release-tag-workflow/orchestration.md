# Orchestration: Week 26 Release Tag Workflow

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the focused test fails because the workflow is absent, add the workflow
  rather than weakening the test.
- If the workflow needs a brand scan, assemble the blocked pattern from
  fragments so the tracked file does not contain the blocked term.
- Do not run tag creation or tag push commands in this workflow.
- Do not run `--check-remote` in tag-push CI because the tag is expected to
  exist remotely after push.
- If main CI fails after push, inspect the failed job before continuing.

## Packet Prompts

- Test contract: add a test for the release tag workflow trigger, checks,
  read-only posture, and lack of tag mutation commands.
- Workflow implementation: add the GitHub Actions workflow for the alpha tag.
- Docs: update the tagging runbook and current-state notes.
- Verification: run local checks, brand scan, workflow verifier, and CI.

## Completion Audit

- Confirm no local tag was created.
- Confirm no tag was pushed.
- Confirm workflow uses `contents: read`.
- Confirm workflow contains no tag creation or push commands.
- Confirm CI passed on the workflow-definition commit.
