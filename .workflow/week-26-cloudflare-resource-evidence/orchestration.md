# Orchestration: Week 26 Cloudflare Resource Evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Cloudflare auth is missing, stop at docs and local validation.
- If D1/R2 resources already exist, verify and reuse them rather than creating
  duplicates.
- If a migration command runs without `--remote`, document it as local-only and
  rerun with `--remote` for release evidence.
- If Worker deployments do not exist, record that fact and keep deploy/route
  work out of this slice.

## Packet Prompts

### 01-resource-create

Create or verify D1/R2 resources in the gHive account and update
`wrangler.jsonc` with non-placeholder D1 IDs.

### 02-staging-migrations

Apply migrations to remote staging D1 and verify `schema_migrations` and table
names.

### 03-gate-docs

Add resource evidence docs and tighten release gate validation.

### 04-verification

Run local gates, brand scans, workflow verifier, push, watch CI, and record the
result.

## Completion Audit

This slice is complete when Cloudflare resource evidence passes release gate and
only live-client evidence remains blocked. Completion does not require Worker
deploy, route writes, secret writes, production migration apply, or live HTTP
smoke.
