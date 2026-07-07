# Orchestration: Week 26 Account Profile API

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep this slice read-only.
- Integrate tests and compatibility fixtures before broad verification.

## Branching Rules

- If profile response diverges from sync profile, refactor to a shared helper.
- If fixture coverage forces matrix over-promotion, keep live evidence unchanged
  and record fixture-only coverage.
- If release status changes from draft-ready, stop and inspect before writing
  further release evidence.

## Packet Prompts

### 01-profile-route

Add `GET /api/accounts/profile` using the existing authenticated vault request
helper. Reuse sync profile fields and token unlock metadata. Do not add account
mutation behavior.

### 02-compat-docs

Add app test coverage, a compatibility fixture flow, matrix coverage updates,
and current-state documentation. Keep live evidence conservative.

### 03-verification

Run touched tests and broad local checks. Capture release status and repository
brand scan evidence. Push only after local verification passes.

## Completion Audit

This workflow is complete only when the route, tests, fixture flow, docs,
workflow verification, local checks, and post-push CI evidence all pass.
