# Week 26 Linear Seed Current State

## Goal

Make the local Linear seed reflect the current post-publication Week 26 state
without writing to Linear.

## Success Criteria

- The seed records issue state types for active and completed work, including
  rollback rehearsal as an active follow-up.
- The first Pulse update no longer claims that the alpha tag or release is
  pending.
- The seed exposes a completed-release evidence view for post-publication
  readback.
- `pnpm linear:seed` validates the state model and reports counts.
- Docs and tests agree with the seed counts.

## Current Context

- `v0.1.0-alpha` is published and verified at
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- API Worker live smoke, website live evidence, Cloudflare resource evidence,
  and release publication evidence are recorded.
- Email Routing remains blocked on a scoped Cloudflare API token or refreshed
  OAuth scope.
- The current Linear connector is still not proven to target
  `linear.app/honowarden`.

## Constraints

- Do not create or mutate live Linear issues, projects, views, documents, or
  Pulse settings.
- Do not store secrets, mailbox destinations, or token values in the seed.
- Use Linear state types, not workspace-specific state ids or names.

## Risks

- Marking incomplete work as completed would make the tracker misleading.
- Leaving the Pulse text stale would cause the first workspace update to
  contradict the published release.
- Workspace-specific state names would make the seed brittle before live apply.

## Approval Required

Live Linear writes require a confirmed `honowarden` workspace session or API
key. This workflow only changes local repo files and needs no external write.

## Work Packets

- `01-seed-state`: Add issue state types, update Pulse, and add the published
  evidence view.
- `02-validation-docs`: Validate state types in the seed script and update tests
  and docs.

## Integration Policy

Accept only changes that make the local seed more accurate without claiming live
Linear application has happened.

## Verification

- `pnpm linear:seed`
- targeted Linear seed tests
- broad repo checks as warranted before PR
- workflow artifact verifier

## Reusable Artifacts

The issue `stateType` model becomes the reusable convention for future Linear
apply tooling.
