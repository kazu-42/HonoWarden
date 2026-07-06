# Orchestration: Week 18 TOTP Login

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If challenge response compatibility is uncertain, keep a documented generic response and add follow-up live-client evidence instead of hardcoding undocumented fields into many places.
- If TOTP replay prevention cannot be made atomic in the repository layer, do not mark the slice complete.
- If any test fixture includes real secrets or one-time codes from a real account, reject it.

## Packet Prompts

### 01-totp-domain

Objective: implement pure TOTP helpers.

Do: generate base32 secrets, calculate HOTP/TOTP codes with Web Crypto, verify current/adjacent time windows, classify replay candidates, and test invalid/replay/stale behavior.

Do not: persist state or touch route handlers.

### 02-schema-repository

Objective: add D1 schema and repository support.

Do: add migration for TOTP state, repository functions for pending setup, enablement, lookup, and atomic accepted-step recording.

Do not: expose endpoints.

### 03-route-integration

Objective: integrate TOTP into authenticated setup and password grant.

Do: add setup/verify endpoints, return challenge for enabled users without code, accept valid code, reject invalid/replay code, and preserve generic wording.

Do not: change existing token success shape for non-TOTP users.

### 04-docs-verification

Objective: document and verify Week18.

Do: update spec/current-state/workflow, run gates, brand scan, workflow verifier, push, and record CI.

## Completion Audit

Completion requires local gates and CI evidence. Live migration/deploy/client evidence remains explicitly not implemented unless separately approved.
