# Orchestration: Week 26 Release Status Packet

## Execution Rules

- Keep the original objective intact.
- Do not publish the GitHub Release.
- Do not mutate tags, deploy, change DNS, or change email routing.
- Use existing publish and published packets as the source of truth.

## Branching Rules

- If the published packet is ready, report `published_verified`.
- If the release is no longer a draft but published verification is not ready,
  report `published_not_verified`.
- If the publish packet is ready, report `draft_ready_for_publication`.
- Otherwise report `not_ready_for_publication`.

## Packet Prompts

### Packet 1: Contract

Do: add tests for draft-ready, published-verified, and strict not-ready states.

Do not: mock away the child packet behavior.

### Packet 2: Implementation

Do: add a read-only script that aggregates existing packet outputs.

Do not: run release mutation commands.

### Packet 3: Docs

Do: update the tagging runbook and current-state docs.

Do not: claim the release has been published.

### Packet 4: Verification

Do: run focused tests, broad checks, brand scan, workflow verifier, and a live
status packet against the current draft.

Do not: perform release publication or deployment.

## Completion Audit

- Status packet exists and is tested.
- Current live status reports draft-ready before publication.
- Actual publication remains externally approval-gated.
