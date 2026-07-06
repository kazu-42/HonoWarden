# Orchestration: Week 21 Audit Observability

## Execution Rules

- Keep audit events secret-safe by construction.
- Prefer enum-like context values over raw request details.
- Keep logging opt-in until retention and access control are verified.
- Ask for approval before enabling audit logs in live environments.

## Branching Rules

- If an event would need a body, payload, password, token, key, hash, or encrypted value, do not log it.
- If an event cannot identify a user safely, log request and device context only.
- If logging becomes noisy in tests, keep emission behind an env flag.

## Packet Prompts

### 01-audit-domain

Objective: define the audit event contract and sanitization rules.

Do: add domain tests and implementation for event building, serialization, and opt-in parsing.

Do not: add persistence or external logging dependencies.

### 02-route-instrumentation

Objective: emit first useful audit events.

Do: instrument password-grant failures, refresh-token reuse, bootstrap success, and device revoke outcomes.

Do not: log request bodies, tokens, passwords, encrypted payloads, or vault fields.

### 03-docs-verification

Objective: record the Week 21 increment and prove local/CI gates.

Do: update docs/current-state/workflow, run gates, brand scan, workflow verifier, push, and record CI.

## Completion Audit

Completion requires tests proving sanitization and route-level opt-in emission, plus local gates, repository brand scan, workflow verifier, and CI. Live log-retention verification remains out of scope.
