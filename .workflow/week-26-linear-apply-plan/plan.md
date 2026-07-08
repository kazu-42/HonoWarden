# Week 26 Linear apply plan

## Goal

Build a local-only, deterministic Linear seed apply-plan command that prepares
future live tracker writes without mutating Linear.

## Success Criteria

- `pnpm linear:apply-plan` emits JSON from `ops/linear/honowarden.seed.json`
  without credentials or network access.
- The command blocks by default until a ready `linear:preflight` report is
  supplied.
- `--strict` exits non-zero when the plan is blocked.
- A ready preflight report classifies seed operations as create,
  confirm-existing, create-or-update, pending-preflight, or manual-confirm.
- Tests prove the command does not call `fetch` and does not need
  `LINEAR_API_KEY`.
- Docs explain that this is still non-mutating and must not replace strict
  preflight or manual workspace readback.

## Current Context

- PR #13 merged `pnpm linear:preflight`, a read-only guard for validating the
  active Linear API key, workspace slug, team, and workflow state types.
- `direnv exec .` currently loads HonoWarden defaults and Cloudflare IDs, but
  `LINEAR_API_KEY` is empty/missing, so strict preflight remains blocked with
  `linear_api_key_missing`.
- Live Linear writes are therefore still out of scope for this slice.

## Constraints

- No live Linear mutation.
- No secret reads or secret printing.
- No dependency on the Linear MCP connector while it may target another
  workspace.
- Keep any future mutation assumptions reviewable before implementation.

## Risks

- A dry-run plan can be mistaken for an applied state if docs are vague.
- Inventory from preflight does not include every object type needed for a full
  idempotent apply, especially issues and milestones.
- Custom view and Pulse automation may remain manual or API-version-specific.
- Linear API key scopes may allow read but not write; a future mutating
  importer must prove write permission separately.

## Approval Required

No external approval is required for this slice because it is local-only and
does not write to Linear. A future mutating importer will require strict
preflight readiness and an explicit `--execute`/confirmation gate.

## Work Packets

- `01-script`: implement the apply-plan JSON command and package script.
- `02-tests`: add child-process tests for blocked, strict, ready, mismatch, and
  no-network behavior.
- `03-docs`: document the safe apply sequence and remaining live-write
  blockers.
- `04-integration`: run targeted and repo gates, review output, and merge only
  if green.

## Integration Policy

Accept only deterministic local output and explicit blocking semantics. Reject
any implementation that reads `LINEAR_API_KEY`, calls `fetch`, or claims that
the seed has been applied.

## Verification

- `pnpm exec vitest run test/ops/linear-apply-plan.test.ts`
- `pnpm linear:apply-plan`
- `pnpm linear:apply-plan -- --strict` must exit non-zero while no preflight
  report is supplied.
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-linear-apply-plan`
- `git diff --check`

## Reusable Artifacts

The apply-plan command becomes the reusable handoff artifact between
read-only preflight and a future guarded mutating importer.
