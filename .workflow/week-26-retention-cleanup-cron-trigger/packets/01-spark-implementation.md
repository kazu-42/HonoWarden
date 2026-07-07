# Packet 01: Spark Implementation

Objective: add local scheduled retention cleanup support.

Files:

- `src/index.ts`
- `src/app.ts`
- `src/maintenance/retention-cleanup.ts`
- `wrangler.jsonc`
- `test/scheduled.test.ts`
- `test/wrangler-environments.test.ts`
- `test/app.test.ts`

Do:

- Extract reusable transient auth cleanup logic from `app.ts`.
- Use the shared cleanup logic from the password-grant path.
- Add a Worker `scheduled` handler that calls the same cleanup using
  `controller.scheduledTime`.
- Configure hourly UTC cron triggers for default, staging, and production
  wrangler targets.
- Add focused tests for scheduled cleanup and cron configuration.

Do not:

- Deploy or call Cloudflare APIs.
- Add cleanup for durable vault data.
- Touch docs or workflow artifacts.
- Run broad QA.
