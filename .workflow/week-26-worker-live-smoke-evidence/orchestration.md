# Orchestration: Week 26 Worker Live Smoke Evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the published release no longer targets
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`, stop and re-run release packet
  verification before touching live evidence.
- If live smoke fails, do not mark Worker evidence passed; record the failed
  endpoint, rollback or abort decision, and resulting health readback.
- If rollback is not exercised, keep rollback evidence below `passed`.
- If a previous Cloudflare version is not a verified safe target, record it only
  as a candidate handle and leave the approved rollback command unresolved.
- If ops readiness still blocks on Worker evidence after docs update, inspect
  the packet contract before proceeding to website/email work.

## Packet Prompts

### 01-release-publication

Record published prerelease URL, target commit, publication timestamp, and
verification packet outputs.

### 02-worker-deploy-smoke

Record release-target deploy correction, staging and production deployment IDs,
Worker version IDs, production migration state, and redacted smoke results.

### 03-readiness-and-rollback

Record candidate previous-version handles without claiming approved rollback
readiness, then verify the ops readiness packet reports the next real blocker.

### 04-verification

Run local format/brand/diff/workflow checks, local review, GitHub PR checks,
and merge readback.

## Completion Audit

- Evidence files contain no secrets, tokens, private inbox destinations, or real
  vault data.
- Worker live-smoke status is `passed`.
- Rollback evidence remains `partial` until the API Worker has a verified safe
  rollback target and website/email rollback and rehearsal evidence exists.
- Remaining blockers are explicitly website, email, or rollback related.
