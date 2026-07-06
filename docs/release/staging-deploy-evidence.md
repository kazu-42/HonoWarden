# Staging Deploy Dry Run Evidence

Target: `v0.1.0-alpha`.

Date: 2026-07-06.

Status: passed.

Mode: staging deploy dry-run.

This evidence records a local Wrangler staging deploy dry-run. It proves the
staging Worker can be bundled with the expected staging bindings from
`wrangler.jsonc`, and that the generated Worker bundle was written and hashed.
It does not prove a live Cloudflare deployment, real D1/R2 resource existence,
custom route readiness, or HTTP health behavior on a deployed Worker.

## Run Identity

- Source commit: `2905151b874d8d78cc564cd65862bffb28c8958b`
- Working tree: clean
- Wrangler version: `4.107.0`
- Evidence command:
  `pnpm staging:dry-run --out test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle --json test/.tmp/staging-dry-run-evidence-20260706T145200Z/report.json --require-clean`
- Dry-run command:
  `pnpm wrangler deploy --env staging --dry-run --outdir test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle`

## Staging Bindings

- Worker name: `honowarden-staging`
- Environment variable: `HONOWARDEN_ENV=staging`
- D1 binding: `DB -> honowarden-staging`
- R2 binding: `VAULT_OBJECTS -> honowarden-staging-vault-objects`
- Bootstrap default: `HONOWARDEN_BOOTSTRAP_ENABLED=false`
- Audit log default: `HONOWARDEN_AUDIT_LOGS=false`
- Staging and production Worker names: separated
- Staging and production storage names: separated

## Bundle

- Bundle path:
  `test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle/index.js`
- Bundle bytes: `172646`
- Bundle SHA-256:
  `8412ccc0028b96b655d7bcff3a4021aeb626422acc2a7b85ad8b2025867b442a`

## Local Smoke Checks

Local smoke checks:

- `wrangler deploy --env staging --dry-run` exited successfully.
- Wrangler output included `--dry-run: exiting now.`
- Wrangler output included `env.DB (honowarden-staging)`.
- Wrangler output included
  `env.VAULT_OBJECTS (honowarden-staging-vault-objects)`.
- Wrangler output included `env.HONOWARDEN_ENV ("staging")`.
- The generated `index.js` bundle exists and has a non-empty SHA-256 hash.

## Limitations

- Remote deploy: not performed.
- Cloudflare resource mutation: not performed.
- Placeholder database IDs: still present.
- HTTP health smoke against a deployed Worker: not performed.

This evidence resolves only the repository-local staging dry-run gate. It does
not replace Cloudflare resource evidence, live client evidence, or deployed
staging HTTP smoke evidence.
