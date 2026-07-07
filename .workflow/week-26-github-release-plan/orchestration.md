# Orchestration: Week 26 GitHub Release Plan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If focused tests fail because the script is absent, implement the script
  rather than weakening the tests.
- If the release plan command would mutate GitHub, reject that implementation.
- If the tag is missing before the actual tag cut, use explicit
  `--allow-missing-tag` only for pre-tag planning.
- If the final post-tag run is needed, require strict mode without missing-tag
  allowances.
- Do not run `gh release create` in this workflow.

## Packet Prompts

- Tests: add a focused test for JSON output, draft command shape, release notes
  validation, and strict failure behavior.
- Script: add a read-only GitHub release planning script and package script.
- Docs: update runbook, alpha release notes, and current state.
- Verification: run local checks, brand scan, workflow verifier, and CI.

## Completion Audit

- Confirm no GitHub release was created.
- Confirm no tag was created or pushed.
- Confirm the emitted command includes `--draft`, `--prerelease`, and
  `--verify-tag`.
- Confirm CI passed on the final commit.
