# Orchestration: Week 26 Release Published Packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before external writes or deployments.
- Do not publish the GitHub Release in this workflow.
- Do not mutate tags, deploy, change DNS, or change email routing.
- Integrate packet results before final verification.

## Branching Rules

- If no release exists, block.
- If the release remains a draft, block and report `not_ready`.
- If the release is not marked as a prerelease, block.
- If the release target commit does not match the tag commit, block.
- If tag workflow evidence is missing or not successful for the target commit,
  block.
- If release-note body sections are missing, block.

## Packet Prompts

### Packet 1: Contract

Do: add tests for published success, draft blocking, and missing workflow
evidence.

Do not: publish a release.

### Packet 2: Implementation

Do: add a read-only script that verifies published prerelease state.

Do not: run any release mutation command.

### Packet 3: Docs

Do: update release docs so publication is followed by the published packet.

Do not: claim the release has already been published.

### Packet 4: Verification

Do: run focused tests, broad repo checks, brand scan, workflow verifier, and a
live fail-closed check against the current draft.

Do not: proceed to release publication without explicit operator approval.

## Completion Audit

- Published packet exists and is tested.
- Docs explain the post-publication gate.
- Current draft state causes the packet to fail closed.
- Actual publication remains externally approval-gated.
