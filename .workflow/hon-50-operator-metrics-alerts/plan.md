# HON-50 operator metrics alerts

## Goal

Close Linear HON-50 by adding repo-owned, operator-facing metrics and alert
classification for request quota pressure and cleanup health.

## Success Criteria

- `pnpm abuse:report` remains dry-run-first and emits the D1 query packet needed
  for rate-limit and cleanup metrics.
- The packet includes alert classifications with warning and critical
  thresholds plus first-response guidance.
- The packet and docs remain secret-safe: no plaintext client addresses,
  bearer tokens, operator identities, vault payloads, or private user data.
- Runbooks and current-state docs distinguish implemented operator alert
  packets from still-missing external notification sinks or dashboards.
- CI-relevant tests, lint, typecheck, release gate, and workflow verification
  pass before Linear is moved to Done.

## Current Context

HON-46 added opt-in global request quotas and the first `pnpm abuse:report`
query packet. HON-51 added bounded retention cleanup and live Cron evidence, but
the runbook still listed cleanup metrics and alerting as remaining work.

## Constraints

- No production deploy or D1 mutation is required for this issue.
- No external alert destination setup is in scope.
- Linear is the source of truth for work state; write scope and evidence must be
  returned there before closing.
- Global request quotas stay disabled by default.

## Risks

- Mixing abuse signals with infrastructure failures could cause wrong incident
  severity; alert IDs must separate quota pressure, auth locks, cleanup backlog,
  and Cron failure.
- Operator evidence can leak sensitive data if the CLI exposes raw bucket
  values, private identifiers, or vault fields.
- Duplicated retention constants can drift; tests pin the current public packet
  values and docs name the corresponding runbook.

## Approval Required

No approval is required for local code/docs/tests/PR work. Approval would be
required before production deploys, live D1 mutations, external alert sink
configuration, or manual D1 row deletion.

## Work Packets

- Packet A: CLI schema and query expansion for cleanup candidate metrics.
- Packet B: alert classification and first-response guidance.
- Packet C: runbook/current-state/known-limitations updates.
- Packet D: focused and broad verification, PR, CI, merge, and Linear closeout.

## Integration Policy

Keep the CLI packet as the executable source for operator metrics. Docs should
describe how to use the packet and what remains out of scope, not introduce a
separate operational model.

## Verification

- `pnpm test -- test/ops/abuse-report-cli.test.ts test/ops/retention-cron-evidence.test.ts test/security-docs.test.ts`
- `pnpm format`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/hon-50-operator-metrics-alerts`
- `git diff --check`

## Reusable Artifacts

The workflow directory documents the pattern for closing small Linear-backed
ops gaps through a dry-run-first CLI packet, docs, and CI-backed secret-safety
tests.
