# Orchestration: Week 26 Unsupported Mutation Guards

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Integrate packet results before final verification.
- Do not introduce partial storage or mutation behavior for out-of-scope alpha
  surfaces.

## Branching Rules

- If route tests show supported routes are intercepted, narrow or move the guard
  routes before continuing.
- If a guard requires storage or secrets, reject that implementation and keep the
  route explicitly unsupported.
- If release status changes from draft-ready to anything else, stop and inspect
  before writing further release evidence.

## Packet Prompts

### 01-route-guards

Add explicit unsupported guards in `src/app.ts` for collection,
emergency-access, attachment, cipher-attachment, and device metadata/trust/key
mutation paths. Preserve existing supported route contracts.

### 02-tests-docs

Extend app route tests to prove these paths return the existing unsupported JSON
contract and preserve request IDs. Update `docs/current-state.md` to record the
guard and the functionality that remains unimplemented.

### 03-verification

Run touched tests and broad local checks. Capture release status and repository
brand scan evidence. Push only after local verification passes.

## Completion Audit

This workflow is complete only when implementation, tests, docs, workflow
verification, local checks, and post-push CI evidence all pass.
