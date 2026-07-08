# Result 03: Readiness And Rollback

Accepted.

- Worker candidate previous-version handles are recorded.
- Approved Worker rollback commands remain unresolved because the previous
  versions are pre-correction `main` deployments.
- Rollback status remains `partial`.
- Website live evidence and Email Routing live evidence remain separate
  blockers.
- `pnpm ops:readiness:packet` reported `not_ready` with
  `blockingReason: "website_live_evidence_missing"`, and
  `worker_live_smoke_recorded` passed.
