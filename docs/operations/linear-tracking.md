# Linear Tracking Setup

This document describes the intended HonoWarden Linear setup.

As of 2026-07-08 JST, the intended workspace is `linear.app/honowarden`, but
the available Linear MCP connection returns teams and projects from an `interx`
workspace. Do not create HonoWarden issues through that MCP connection until it
resolves to `linear.app/honowarden`.

## Source Of Truth

The seed file is [ops/linear/honowarden.seed.json](../../ops/linear/honowarden.seed.json).
Validate the local seed shape with:

```sh
pnpm linear:seed
```

Verify the active Linear API key and workspace before any live writes with:

```sh
pnpm linear:preflight -- --strict
```

`linear:preflight` is read-only. It checks the Linear GraphQL organization
`urlKey`, the `HW` / `HonoWarden` team, and the workflow state types needed by
the seed before reporting `status: "ready"`. It rejects custom GraphQL
endpoints before attaching the API key, and it treats local workspace slug
environment overrides as a mismatch unless they match the checked-in seed.
Project-scoped views remain manual inventory because they are created from the
project issue list rather than the root view list.

Create a local, non-mutating apply plan with:

```sh
pnpm linear:apply-plan
```

When strict preflight is ready, save that preflight JSON and use it to classify
which seed objects already exist and which still need creation:

```sh
mkdir -p test/.tmp
pnpm linear:preflight -- --strict > test/.tmp/linear-preflight.ready.json
pnpm linear:apply-plan -- --preflight-report test/.tmp/linear-preflight.ready.json --strict > test/.tmp/linear-apply-plan.ready.json
pnpm linear:mutation-packet -- --apply-plan test/.tmp/linear-apply-plan.ready.json --strict
```

`linear:apply-plan` does not read `LINEAR_API_KEY` and does not call Linear. It
requires the saved preflight report to include the same seed fingerprint and
page-complete inventory expected-name set as the current seed before it can
classify objects as create or confirm-existing. It is a planning artifact only;
it must not be treated as proof that issues, projects, views, documents, or
Pulse settings were applied.

`linear:mutation-packet` also stays local-only. It consumes a ready apply-plan
JSON, separates mutation candidates from existing-object confirmations and
manual confirmations, and preserves operation payloads for a future guarded
writer. Blocked input plans intentionally produce no mutation steps. The packet
does not resolve Linear IDs, does not read credentials, and does not execute
writes.

The seed defines:

- one team: `HW` / `HonoWarden`
- one initiative: `HonoWarden Alpha Launch`
- three projects: alpha API, operations readiness, and website/domain, updated
  to reflect that the website repository and HTTPS domains are live while Email
  Routing remains gated
- Week 20 through Week 26 milestones for the alpha API project
- labels for area, type, risk, evidence, agent ownership, and alpha release gate
- initial issues covering Week 20 through Week 26, Cloudflare resources, website,
  domain/email routing, live official-client evidence, cleanup jobs, rollback
  rehearsal, and release automation
- issue `stateType` values that map to Linear state types, currently 14
  completed items and four started follow-ups
- custom view definitions
- Pulse cadence and the first status-update body

Current validated counts:

- 15 labels
- 3 projects
- 7 milestones
- 18 issues
- 7 shared view definitions
- issue state counts: 14 completed, 4 started
- 1 tracking overview document

## Access Prerequisites

Before applying the seed, make sure the active Linear account has access to the
`honowarden` workspace as a full member. Admin access is required for workspace
settings such as Pulse defaults and, depending on the workspace settings, team
creation.

Safe verification steps:

1. Open `https://linear.app/honowarden/`.
2. Confirm the URL stays under `/honowarden/` and does not show an
   authentication error.
3. Confirm the Linear MCP `list_teams` result returns the HonoWarden team and
   does not return only unrelated workspace teams.
4. If using `LINEAR_API_KEY`, run `pnpm linear:preflight -- --strict` and
   require `status: "ready"`.
5. Generate a strict apply plan and review the create/confirm/manual
   operations:

   ```sh
   pnpm linear:apply-plan -- --preflight-report <ready-report> --strict
   ```

6. Generate a strict mutation packet from the reviewed ready apply plan:

   ```sh
   pnpm linear:mutation-packet -- --apply-plan <ready-apply-plan> --strict
   ```

7. Only then create issues, projects, and documents through MCP or API tooling.

## Recommended Apply Order

1. Create the `HonoWarden` team with key `HW` if it does not exist.
2. Create labels from the seed.
3. Create the `HonoWarden Alpha Launch` initiative.
4. Create the three projects and associate them with the initiative where the UI
   allows it.
5. Create Week 20 through Week 26 milestones on `HonoWarden v0.1.0-alpha`.
6. Create the tracking overview document on the alpha project.
7. Create issues in seed order, preserving `blockedBy` relationships after both
   sides exist and mapping each issue `stateType` to the workspace state with
   the matching Linear state type.
8. Post the first project update from the seed Pulse section.
9. Create the custom views and favorite the high-signal views in the sidebar.

Do not skip the preflight. A passing `pnpm linear:seed` only proves the checked
in seed is internally coherent; it does not prove that the active Linear
connector or API key targets `linear.app/honowarden`.

Do not skip the apply-plan review. A ready preflight proves the workspace and
team are safe targets; it does not prove every seed object already exists or
that Pulse/custom-view settings can be represented by the same automation path.

Do not treat the mutation packet as execution evidence. It is the handoff format
for a future guarded writer, not proof that the writer ran.

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
- `Published Alpha Evidence`: completed `release:alpha` issues, grouped by
  project, for readback after publication.

Use shared team or project views, not personal-only views, for the command center
and release gate. Keep personal Pulse custom feeds optional.

## Pulse And Updates

Enable Pulse in workspace settings once an admin is available.

Recommended defaults:

- Pulse summary: weekdays, delivered by 07:00 local time.
- Alpha project update reminder: Monday and Friday at 18:00 Asia/Tokyo.
- Operations and website project update reminder: Friday at 18:00 Asia/Tokyo.
- Health default for the first update: `atRisk` until Email Routing is tested,
  live-client evidence is broadened beyond the CLI smoke, and rollback evidence
  is no longer partial.

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
