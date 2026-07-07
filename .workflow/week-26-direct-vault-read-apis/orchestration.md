# Orchestration: Week 26 Direct Vault Read APIs

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep this workflow read-only.
- Integrate repository tests, HTTP tests, and fixtures before broad verification.

## Branching Rules

- If direct list responses diverge from sync responses, reuse existing response
  builders instead of introducing a new shape.
- If single-row reads can return cross-user rows, stop and fix repository scope
  before adding fixtures.
- If release status changes from draft-ready, stop and inspect before writing
  further release evidence.

## Packet Prompts

### 01-repositories-routes

Add owner-scoped `findFolderById` and `findCipherById` repository functions.
Expose authenticated `GET /api/folders`, `GET /api/folders/:id`,
`GET /api/ciphers`, and `GET /api/ciphers/:id` routes.

### 02-tests-fixtures-docs

Add HTTP route tests, repository tests, direct read compatibility fixtures,
matrix coverage, and current-state notes. Keep live evidence conservative.

### 03-verification

Run touched tests and broad local checks. Capture release status and repository
brand scan evidence. Push only after local verification passes.

## Completion Audit

This workflow is complete only when implementation, tests, fixture flow, docs,
workflow verification, local checks, and post-push CI evidence all pass.
