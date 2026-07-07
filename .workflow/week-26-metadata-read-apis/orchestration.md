# Orchestration: Week 26 Metadata Read APIs

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep this workflow read-only.
- Integrate route tests and fixtures before broad verification.

## Branching Rules

- If metadata routes require new persisted state, reject that implementation and
  keep the scope empty/read-only.
- If sync and direct domain metadata diverge, refactor to a shared response
  helper.
- If release status changes from draft-ready, stop and inspect before writing
  further release evidence.

## Packet Prompts

### 01-routes

Add authenticated `GET /api/policies`, `GET /api/policies/new`,
`GET /api/domains`, and `GET /api/settings/domains`. Reuse sync domain metadata
for direct domain routes.

### 02-tests-fixtures-docs

Add HTTP route tests, metadata compatibility fixtures, matrix coverage, and
current-state documentation. Keep live evidence conservative.

### 03-verification

Run touched tests and broad local checks. Capture release status and repository
brand scan evidence. Push only after local verification passes.

## Completion Audit

This workflow is complete only when implementation, tests, fixture flow, docs,
workflow verification, local checks, and post-push CI evidence all pass.
