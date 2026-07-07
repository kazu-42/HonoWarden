# Packet 02: Main Docs And Verification

Objective: document and verify scheduled retention cleanup.

Files:

- `docs/current-state.md`
- `docs/operations/retention-cleanup.md`
- `.workflow/week-26-retention-cleanup-cron-trigger/**`

Do:

- Update docs for the configured but not-yet-deployed Cron Trigger.
- Review Spark changes.
- Run focused and broad checks, release readbacks, and CI.

Do not:

- Deploy, publish, mutate tags, DNS/email/Cloudflare resources, or secrets.
