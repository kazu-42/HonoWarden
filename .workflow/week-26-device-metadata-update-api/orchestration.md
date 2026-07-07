# Orchestration: Week 26 device metadata update API

## Execution Rules

- Keep the implementation metadata-only: `name`, `type`, and `updated_at`.
- Use authenticated user ID plus path device ID for all updates.
- Leave identifier mutation, trust updates, and key updates out of scope.
- Do not publish releases, deploy, mutate tags, change DNS/email/Cloudflare,
  write Linear, touch secrets, or use production data.

## Branching Rules

- If update tests show a cross-user or revoked-device write, stop and fix the
  repository owner scope before continuing.
- If compatibility fixture replay requires unsupported trust/key behavior,
  keep the fixture out of this slice.
- If release gate fails, inspect local docs/fixture changes before weakening
  gate rules.

## Packet Prompts

### Packet 01: Backend TDD Implementation

Objective: add the owner-scoped metadata update operation and route.

Files:

- `src/repositories/auth-repository.ts`
- `src/app.ts`
- `test/repositories/auth-repository.test.ts`
- `test/app.test.ts`
- `test/support/fake-d1.ts`

Expected output:

- RED tests for repository and HTTP behavior.
- Green implementation for `PUT /api/devices/:id`.
- `PATCH /api/devices/:id`, key, and trust routes remain unsupported.

### Packet 02: Docs Compat Workflow

Objective: update fixture evidence, compatibility matrix, docs, and workflow
state.

Files:

- `compat/**`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`
- `.workflow/week-26-device-metadata-update-api/**`

Expected output:

- `device_update` fixture flow and route replay.
- Current-state and compatibility matrix reflect the new metadata update API.
- Local verification evidence is recorded.

## Completion Audit

- Local checks pass.
- GitHub Actions CI passes after push.
- Release publication remains approval-gated.
