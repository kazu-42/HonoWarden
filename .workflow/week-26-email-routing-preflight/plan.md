# Week 26 Email Routing Preflight

## Goal

Add a local, read-only Email Routing preflight so website/domain email work can
be planned without mutating Cloudflare.

## Success Criteria

- `pnpm email:preflight` prints a JSON readiness report.
- Missing Cloudflare/account/zone/destination values produce `not_ready` without
  failing by default.
- `--strict` exits non-zero when required values are missing.
- Reports never print API tokens or destination inbox values.
- Docs describe how to use the preflight before external writes.

## Current Context

- `honowarden.com` website is live, but Email Routing is not enabled.
- Current Wrangler OAuth lacks Email Routing write scope.
- Operator env docs already define required local env vars.

## Constraints

- Do not call Cloudflare APIs.
- Do not send email.
- Do not store destination inbox values in repo artifacts.

## Risks

- Preflight output could leak destination inboxes or API tokens if not redacted.
- Strict mode must be opt-in so CI can run without operator secrets.

## Approval Required

No approval required for local read-only script, tests, and docs.

## Work Packets

- Script: local JSON preflight with strict mode.
- Tests: readiness, strict failure, and redaction behavior.
- Docs: website-email/operator/current-state usage notes.
- Verification: focused and full local checks.

## Integration Policy

Keep this script offline. External writes remain gated by operator approval.

## Verification

- `pnpm test -- test/ops/email-preflight.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

Use this pattern for future external-service setup: local readiness report,
strict mode for automation, redacted output, then explicit approval before API
writes.
