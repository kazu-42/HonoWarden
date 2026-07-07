# Week 26 Tagging Runbook

## Goal

Add an auditable alpha tagging runbook and make it part of release readiness
without creating or pushing the tag.

## Success Criteria

- Release docs test requires `tagging-runbook.md`.
- Release gate requires the tagging runbook as a substantive release doc.
- The runbook documents preconditions, approval gate, commands, verification,
  failure handling, and post-tag follow-up.
- Docs make tag creation and push explicitly approval-gated.
- Tests, release gate, format, workflow verifier, and brand scan pass.

## Current Context

- `pnpm release:tag:preflight -- --strict` reports ready on commit
  `1eec5264777006884ef4fba448aa104547aefd0f`.
- GitHub Actions CI passed for that commit.
- No local `v0.1.0-alpha` tag exists.
- Tag creation and push still require explicit operator approval.

## Constraints

- Do not create a local tag.
- Do not push a tag.
- Do not publish a GitHub release.
- Do not deploy.
- Do not introduce external compatibility brand names.

## Risks

- A preflight without a runbook can leave rollback and approval semantics
  ambiguous.
- Retagging a pushed tag can break downstream automation and needs incident
  handling, not silent correction.
- Docs that include tag commands can be mistaken for approval unless the gate is
  explicit.

## Approval Required

No approval required for docs, tests, and release gate updates. Approval is
required before tag creation, tag push, remote tag deletion, retagging, release
publication, or deployment.

## Work Packets

- Tests and gate: require the runbook before implementation.
- Runbook: document tag preconditions, approval, commands, verification, and
  failure handling.
- Docs integration: link the runbook from release docs and current state.
- Verification: run local checks and push CI.

## Integration Policy

This slice is release-process documentation and gate metadata only. It must not
change runtime API behavior, schema, deployment config, or create any tag.

## Verification

- focused release docs test
- `pnpm release:gate -- --strict`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this runbook as the reusable release-tagging checklist for future alpha or
stable release cuts.
