# Linear Tracking Setup

This document describes the intended HonoWarden Linear setup. The current local
browser account cannot access `linear.app/honowarden`, and the available Linear
MCP connection points at a different workspace. Do not create HonoWarden issues
through that MCP connection until it resolves to `linear.app/honowarden`.

## Source Of Truth

The seed file is [ops/linear/honowarden.seed.json](../../ops/linear/honowarden.seed.json).
Validate it with:

```sh
node scripts/honowarden-linear-seed.mjs
```

The seed defines:

- one team: `HW` / `HonoWarden`
- one initiative: `HonoWarden Alpha Launch`
- three projects: alpha API, operations readiness, and website/domain
- Week 20 through Week 26 milestones for the alpha API project
- labels for area, type, risk, evidence, agent ownership, and alpha release gate
- initial issues covering Week 20 through Week 26, Cloudflare resources, website,
  domain/email routing, live official-client evidence, cleanup jobs, and release
  automation
- custom view definitions
- Pulse cadence and the first status-update body

## Access Prerequisites

Before applying the seed, make sure the active Linear account has access to the
`honowarden` workspace as a full member. Admin access is required for workspace
settings such as Pulse defaults and, depending on the workspace settings, team
creation.

Safe verification steps:

1. Open `https://linear.app/honowarden/`.
2. Confirm the URL stays under `/honowarden/` and does not show an
   authentication error.
3. Confirm the Linear MCP `list_teams` result also returns HonoWarden teams and
   URLs under `linear.app/honowarden`.
4. Only then create issues, projects, and documents through MCP or API tooling.

## Recommended Apply Order

1. Create the `HonoWarden` team with key `HW` if it does not exist.
2. Create labels from the seed.
3. Create the `HonoWarden Alpha Launch` initiative.
4. Create the three projects and associate them with the initiative where the UI
   allows it.
5. Create Week 20 through Week 26 milestones on `HonoWarden v0.1.0-alpha`.
6. Create the tracking overview document on the alpha project.
7. Create issues in seed order, preserving `blockedBy` relationships after both
   sides exist.
8. Post the first project update from the seed Pulse section.
9. Create the custom views and favorite the high-signal views in the sidebar.

## Views

Create these shared views from Linear's Views page or from the relevant team or
project issue list:

- `Alpha Command Center`: active issues across all HonoWarden projects, board by
  status, priority order.
- `Week 26 Release Gate`: active `release:alpha` issues, list grouped by
  project, priority order.
- `Security and Ops Risk`: active issues labeled `risk:security` or `area:ops`.
- `Agent Queue`: active issues labeled `agent:codex` or `agent:spark`.
- `Website and Domain`: issues in the `Website and Domain` project, board by
  status.
- `Evidence Missing`: active issues labeled `evidence:required`, grouped by
  project.

Use shared team or project views, not personal-only views, for the command center
and release gate. Keep personal Pulse custom feeds optional.

## Pulse And Updates

Enable Pulse in workspace settings once an admin is available.

Recommended defaults:

- Pulse summary: weekdays, delivered by 07:00 local time.
- Alpha project update reminder: Monday and Friday at 18:00 Asia/Tokyo.
- Operations and website project update reminder: Friday at 18:00 Asia/Tokyo.
- Health default for the first update: `atRisk` until live Cloudflare resources,
  live official-client evidence, backup/restore drill evidence, and security
  review materials are recorded.

Every project update should include:

- completed since last update
- current blocker or risk
- next concrete slice
- evidence links: commit, CI run, deployment, runbook, or live-client record
- explicit downgrade if evidence is fixture-only

## Operating Rules

- Closing an issue requires tests, CI, deployment evidence, or an explicit
  reason why the issue is documentation-only.
- Do not paste real secrets, tokens, password hashes, encrypted vault payloads,
  vault exports, or real user vault content into Linear.
- Keep unsupported protocol surfaces explicit; they should fail with documented
  `403` or `501` behavior instead of silently no-oping.
- Keep issue titles small and implementation-oriented. Put rationale and
  acceptance criteria in the description.
- Keep broad discussions in project documents, then link the resulting
  implementation issue.
