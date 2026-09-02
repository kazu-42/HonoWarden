# Staging Deploy Dry Run Evidence

> **HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY.** This document
> records a repository-local 2026-07 Wrangler dry run. It does not establish
> current bundle, binding, source, staging, deployment, health, or rollback
> state, and it does not authorize a Worker upload, activation, rollback,
> resource mutation, route change, or traffic change. The current
> `staging:dry-run` entrypoint is a static blocker; current Worker execution
> remains STOP unless a future remote-write protocol satisfies the admission
> boundary in
> [Build provenance and deployment authority](../operations/deploy-provenance-runbook.md#admission-requirements-for-a-future-remote-write-protocol)
> and receives separate, one-shot authority.

Historical target: `v0.1.0-alpha`.

Historical date: 2026-07-06.

Historical status: passed.

Historical mode: staging deploy dry-run.

This evidence records a local Wrangler staging deployment dry run performed in
2026-07. It proved that the then-reviewed source could be bundled with the then-
configured staging bindings and that the generated Worker bundle was written
and hashed. It does not prove a current bundle, live Cloudflare deployment,
custom-route readiness, or HTTP health behavior. D1/R2 resource creation was
recorded separately in
[Cloudflare Resource Evidence](cloudflare-resource-evidence.md).

## Run Identity

- Source commit: `2905151b874d8d78cc564cd65862bffb28c8958b`
- Working tree: clean
- Wrangler version: `4.107.0`
- Historical evidence command (immutable record; the current entrypoint is a
  static blocker):
  `pnpm staging:dry-run --out test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle --json test/.tmp/staging-dry-run-evidence-20260706T145200Z/report.json --require-clean`
- Historical Wrangler dry-run command (local bundle only; not current
  authority):
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
- Database ID placeholder: false

## Bundle

- Bundle path:
  `test/.tmp/staging-dry-run-evidence-20260706T145200Z/bundle/index.js`
- Bundle bytes: `172646`
- Bundle SHA-256:
  `8412ccc0028b96b655d7bcff3a4021aeb626422acc2a7b85ad8b2025867b442a`

## Historical Local Smoke Checks

Recorded local smoke checks:

- `wrangler deploy --env staging --dry-run` exited successfully.
- Wrangler output included `--dry-run: exiting now.`
- Wrangler output included `env.DB (honowarden-staging)`.
- Wrangler output included
  `env.VAULT_OBJECTS (honowarden-staging-vault-objects)`.
- Wrangler output included `env.HONOWARDEN_ENV ("staging")`.
- The generated `index.js` bundle exists and has a non-empty SHA-256 hash.

## Limitations

- Remote deploy: not performed.
- Cloudflare resource mutation in this dry-run command: not performed.
- HTTP health smoke against a deployed Worker: not performed.

This evidence resolved only the repository-local staging dry-run gate at its
recorded source commit. It does not satisfy a current gate and does not replace
Cloudflare resource evidence, live client evidence, or deployed staging HTTP
smoke evidence.
