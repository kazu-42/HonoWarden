# Orchestration: Week 26 Release Publish Packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Do not publish the GitHub Release in this workflow.
- Do not mutate tags, deploy, change DNS, or change email routing.

## Branching Rules

- If no draft release exists, block and do not emit publish approval text.
- If the release is not a draft prerelease, block and do not emit publish
  approval text.
- If tag workflow evidence is missing or not successful for the target commit,
  block.
- If release-note body sections are missing, block.
- If local verification or CI fails, fix forward before any publication
  approval.

## Packet Prompts

### Packet 1: CLI Contract

Do: add tests for ready output, non-draft blocking, and missing tag workflow
evidence.

Do not: publish a release.

### Packet 2: Implementation

Do: add a read-only script that verifies draft release state and emits publish
approval material.

Do not: run the emitted command.

### Packet 3: Docs

Do: update release docs so publication requires the packet and a separate
operator approval.

Do not: claim the release has been published.

### Packet 4: Verification

Do: run focused tests, full tests, lint, typecheck, release gate, brand scan,
and workflow verifier.

Do not: proceed to release publication without explicit operator approval.

## Completion Audit

- Publish packet exists and is tested.
- Docs explain the publication gate.
- Workflow state records verification evidence.
- Actual publication remains externally approval-gated.
