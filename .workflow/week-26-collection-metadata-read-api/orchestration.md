# Orchestration: Week 26 Collection Metadata Read API

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep this workflow read-only.
- Ensure mutation routes remain unsupported.

## Branching Rules

- If collection reads require persisted state, reject that implementation and
  keep the response empty.
- If mutation tests stop returning unsupported responses, adjust route order
  before broad verification.
- If release status changes from draft-ready, stop and inspect before writing
  further release evidence.

## Packet Prompts

### 01-routes

Add authenticated `GET /api/collections` and `GET /api/collections/:id` before
the existing unsupported collection guards. Reuse empty list behavior and return
stable not-found for single collection reads.

### 02-tests-fixtures-docs

Add HTTP route tests, collection metadata compatibility fixtures, and
current-state documentation. Keep live evidence conservative.

### 03-verification

Run touched tests and broad local checks. Capture release status and repository
brand scan evidence. Push only after local verification passes.

## Completion Audit

This workflow is complete only when implementation, tests, fixture flow, docs,
workflow verification, local checks, and post-push CI evidence all pass.
