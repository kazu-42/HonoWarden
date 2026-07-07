# Orchestration: Week 26 Release Gate Workflow Coverage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If release gate fails because an included workflow lacks CI evidence, either
  record an already-passed CI run for that workflow or remove the workflow from
  the required list.
- Do not include this current workflow in the required list because its CI run
  cannot exist before this commit is tested.
- If structured check entries break CI evidence detection, add a helper rather
  than rewriting all historical state files.
- Do not run tag creation, tag push, release creation, release publication, or
  deploy commands.

## Packet Prompts

- Gate logic: expand required workflow slugs and support string/object CI
  evidence.
- State evidence: add passed CI run IDs to completed Week 26 workflows.
- Tests and docs: assert the expanded evidence list and document the coverage.
- Verification: run focused and broad local checks, brand scan, workflow
  verifier, and CI.

## Completion Audit

- Confirm strict release gate remains ready.
- Confirm evidence includes representative latest Week 26 workflows.
- Confirm all included Week 26 states are completed, passed, and have CI
  evidence.
- Confirm no tag or release was created.
- Confirm CI passed on the final commit.
