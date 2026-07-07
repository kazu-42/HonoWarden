# Orchestration: Week 26 Release Gate Status Packet Coverage

## Execution Rules

- Keep the original objective intact.
- Do not publish the GitHub Release.
- Do not mutate tags, deploy, change DNS, or change email routing.
- Use already-passed CI run evidence for workflows added to the gate.
- Do not add this current coverage workflow to the gate list.

## Branching Rules

- If the status workflow state lacks CI evidence, add the already-passed run ID
  or leave it out of the gate.
- If the referenced CI run is not successful, do not include that workflow in
  the gate.
- If strict release gate fails, fix forward before committing.

## Packet Prompts

### Packet 1: Gate Logic

Do: add the completed status packet workflow to `requiredWorkflowSlugs`.

Do not: add this current coverage workflow to `requiredWorkflowSlugs`.

### Packet 2: State Evidence

Do: record CI run ID for the completed status packet workflow.

Do not: rewrite unrelated workflow state files.

### Packet 3: Tests And Docs

Do: assert the status workflow path in release gate tests and document
current-state coverage.

Do not: claim the GitHub Release is published.

### Packet 4: Verification

Do: run focused tests, strict release gate, broad local checks, brand scan,
workflow verifier, and CI evidence readback.

Do not: perform release publication or deployment.

## Completion Audit

- Release gate evidence includes the status packet workflow state file.
- Included workflow state is completed, passed, and contains CI evidence.
- This workflow remains excluded from the release gate to avoid self-reference.
