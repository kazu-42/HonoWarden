# Week 26 Linear Tracking Setup

## Goal

Make the HonoWarden Linear workspace setup reproducible and current without
writing into the wrong workspace.

## Success Criteria

- Linear seed reflects current project status through Week 25.
- Seed validation is available through a package script.
- README and operations docs point to the Linear tracking setup.
- Access guard documents the current connector mismatch.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

The repository already contains a Linear seed defining team, initiative,
projects, milestones, labels, issues, view definitions, Pulse cadence, and an
overview document. The active Linear MCP connection currently resolves to a
different workspace, and the DevTools browser is not authenticated to
`linear.app/honowarden`.

## Constraints

- Do not create HonoWarden issues in an unrelated Linear workspace.
- Do not mutate Linear workspace settings until the active session is confirmed
  under `linear.app/honowarden`.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- Workspace mismatch can silently pollute another Linear workspace.
- Pulse/status text can become stale if not updated alongside release progress.
- Views are not currently exposed by the available Linear MCP tools.

## Approval Required

No approval is required for local docs, seed updates, tests, git push, and CI.
Live Linear workspace mutation requires an authenticated `honowarden` session or
connector.

## Work Packets

- `01-seed-status`: Update seed status, package script, and README link.
- `02-access-guard`: Record workspace mismatch and safe apply rules.
- `03-verification`: Run local gates, brand scans, workflow verifier, and CI.

## Integration Policy

Treat the seed as the source of truth until the correct workspace is reachable.
Only create live Linear resources after the MCP or browser session proves it is
operating under `linear.app/honowarden`.

## Verification

- `pnpm linear:seed`
- `pnpm test -- test/ops/linear-seed.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
