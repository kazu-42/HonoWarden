# Orchestration: Week 26 Release Gate Publication Packet Coverage

## Execution Rules

- Keep the original objective intact.
- Do not publish the GitHub Release.
- Do not mutate tags, deploy, change DNS, or change email routing.
- Use already-passed CI run evidence for workflows added to the gate.
- Do not add this current coverage workflow to the gate list.

## Branching Rules

- If either publish or published workflow state lacks CI evidence, add the
  already-passed run ID or leave it out of the gate.
- If either referenced CI run is not successful, do not include that workflow in
  the gate.
- If strict release gate fails, fix forward before committing.

## Packet Prompts

### Packet 1: Gate Logic

Do: add completed publish and published packet workflows to
`requiredWorkflowSlugs`.

Do not: add this current coverage workflow to `requiredWorkflowSlugs`.

### Packet 2: State Evidence

Do: record CI run IDs for those two completed workflows.

Do not: rewrite unrelated workflow state files.

### Packet 3: Tests And Docs

Do: assert both workflow paths in release gate tests and document current-state
coverage.

Do not: claim the GitHub Release is published.

### Packet 4: Verification

Do: run focused tests, strict release gate, broad local checks, brand scan,
workflow verifier, and CI evidence readback.

Do not: perform release publication or deployment.

## Completion Audit

- Release gate evidence includes both publication packet workflow state files.
- Included workflow states are completed, passed, and contain CI evidence.
- This workflow remains excluded from the release gate to avoid self-reference.
