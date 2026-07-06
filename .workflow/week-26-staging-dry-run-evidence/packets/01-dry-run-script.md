# Packet 01: Dry Run Script

Objective: Add a reproducible staging deploy dry-run command.

Files / sources:

- `scripts/honowarden-staging-dry-run.mjs`
- `package.json`
- `wrangler.jsonc`
- `test/ops/staging-dry-run.test.ts`

Do:

- Run Wrangler staging deploy dry-run into an ignored output directory.
- Validate staging Worker, D1, R2, environment, bootstrap, and audit defaults.
- Record bundle bytes and SHA-256.
- Keep placeholder database IDs visible as a limitation.

Do not:

- Deploy or create Cloudflare resources.
- Set secrets.
- Treat dry-run evidence as live HTTP smoke evidence.

Verification:

- Targeted staging dry-run test passes.
