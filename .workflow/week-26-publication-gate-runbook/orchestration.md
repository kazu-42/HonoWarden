# Orchestration: Week 26 Publication Gate Runbook

Goal:
Make GitHub Release publication approval easy to verify without performing the
publication.

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If release status packet output is not `draft_ready_for_publication`, stop
  and inspect publish/published packet failures before updating docs.
- If release gate fails after adding the document, inspect required docs and doc
  length before weakening the gate.
- If the GitHub Release is no longer a draft, do not publish or edit it; read
  back state and switch to post-publication verification.

## Packet Prompts

- `01-runbook`: write `docs/release/publication-gate.md` and link it from the
  release index.
- `02-gate-tests`: make the runbook required by release gate and covered by
  release docs tests.
- `03-verification`: run checks, push, watch CI, and confirm release draft
  state is unchanged.

## Completion Audit

- The runbook must include the exact approval text and repo-scoped publish
  command.
- The release gate must remain `overall: "ready"`.
- The GitHub Release must remain draft until explicit publication approval is
  received.
