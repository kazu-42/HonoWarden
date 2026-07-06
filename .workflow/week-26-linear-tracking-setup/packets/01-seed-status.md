# Packet 01: Seed Status

## Objective

Refresh the Linear seed to reflect the current repository state.

## Scope

- `ops/linear/honowarden.seed.json`
- `package.json`
- `README.md`

## Tasks

- Add `pnpm linear:seed`.
- Update the first project status update to reference Week 25 completion and
  current release risks.
- Link Linear tracking docs from README.

## Acceptance

- `pnpm linear:seed` prints a valid summary.
- The seed still includes projects, issues, view definitions, and Pulse data.
