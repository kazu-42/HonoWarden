# Orchestration: Week 26 Release Command Repository Scope

## Execution Rules

- Keep the original objective intact.
- Do not publish the GitHub Release.
- Do not mutate tags, deploy, change DNS, or change email routing.
- Scope emitted GitHub Release commands to `kazu-42/HonoWarden`.

## Branching Rules

- If any emitted `gh release create`, `gh release view`, or `gh release edit`
  command lacks `--repo kazu-42/HonoWarden`, update it or record why it is not
  operator-facing.
- If tests fail due command string drift, update the test to reflect the safer
  repo-scoped command.

## Packet Prompts

### Packet 1: Implementation

Do: add repo scope to emitted release commands.

Do not: run the emitted mutation commands.

### Packet 2: Tests And Docs

Do: update tests and current-state docs for repo-scoped command output.

Do not: claim the release has been published.

### Packet 3: Verification

Do: run focused tests, broad local checks, live status packet, brand scan, and
workflow verifier.

Do not: perform release publication or deployment.

## Completion Audit

- Operator-facing release commands are repo-scoped.
- Current live status remains draft-ready.
- Actual publication remains externally approval-gated.
