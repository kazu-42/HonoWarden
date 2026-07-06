# Orchestration: Week 19 Recent Reauth

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If adding auth method breaks existing token verification, make the new claim optional for verification and required only by the new recent-auth guard.
- If a route is not sensitive in the Week 19 acceptance criteria, do not move it to the recent-auth helper.
- If live client protocol evidence is needed, stop at local implementation and document it as remaining evidence.

## Packet Prompts

### 01-token-claims

Objective: distinguish password-auth access tokens from refresh-auth access tokens.

Do: extend token claims, update password and refresh issuance, and add tests.

Do not: invalidate legacy tokens solely because the claim is absent.

### 02-recent-auth-guard

Objective: require recent password-auth access tokens for TOTP setup and setup verification.

Do: add a helper around bearer authentication that checks auth method and token age, with app tests for stale and refresh-auth rejection.

Do not: apply the guard to normal sync or vault CRUD routes.

### 03-docs-verification

Objective: record the Week 19 increment and verify.

Do: update current-state/workflow, run local gates, push, and record CI.

## Completion Audit

Completion requires passing local gates, repository brand scan, workflow verifier, and CI. Live deployment and live client evidence are out of scope for this local slice.
