# Upgrade Guide

Target: `v0.1.0-alpha`.

Last updated: 2026-07-20.

This guide covers upgrading an existing alpha environment. HonoWarden is
pre-alpha, so operators should assume upgrades can require maintenance windows
and fresh-target restore drills.

## Before Upgrading

1. Confirm the target commit has passing CI.
2. Review [Migration Freeze](migration-freeze.md).
3. Review [Known Limitations](../security/known-limitations.md).
4. Export a backup using the operator runbook.
5. Restore that backup into a fresh disposable target if this is production-like
   data.
6. Confirm no real vault secrets are being used during alpha testing.

## Backup

Plan export:

```sh
pnpm backup:export -- \
  --out backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode remote \
  --env production \
  --r2-objects object-keys.txt
```

Execute only after reviewing the plan:

```sh
pnpm backup:export -- \
  --out backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ) \
  --database honowarden \
  --bucket honowarden-vault-objects \
  --mode remote \
  --env production \
  --r2-objects object-keys.txt \
  --execute
```

## Migration Policy

- Apply migrations before deploying code that depends on them.
- `0004_totp_change.sql` must be applied before deploying a Worker commit that
  serves the TOTP change routes.
- `0005_device_keys.sql` must be applied before deploying a Worker commit that
  serves the encrypted device key routes.
- `0010_equivalent_domains.sql` must be applied before deploying a Worker
  commit that serves custom equivalent-domain settings writes.
- `0014a_kdf_population.sql` must be applied before deploying a Worker commit
  that serves materialized KDF prelogin reads. Keep KDF mutation disabled while
  migration and reader behavior are verified.
- `0016_user_key_rotation_wrapper_history.sql` must be applied before deploying
  the Worker commit that records account-key initialization, password, KDF, and
  user-key wrapper history.
  Drain credential mutation requests across the migration/Worker activation
  window because password change has no independent feature switch. Keep
  `HONOWARDEN_ACCOUNT_KEYS_ENABLED=false`,
  `HONOWARDEN_KDF_MUTATION_ENABLED=false` and
  `HONOWARDEN_USER_KEY_ROTATION_ENABLED=false` until `/health/db` reports the
  table and a reader-capable rollback Worker has been verified. The migration
  cannot reconstruct wrappers superseded before `0016`.
- Do not edit an already-applied migration file.
- Add forward-only migrations for future schema changes.
- Update `docs/release/migration-freeze.md` in the same change when migrations
  are added.

## Upgrade Steps

```sh
git fetch origin
git checkout <target-release-commit>
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
```

Apply migrations:

```sh
pnpm wrangler d1 migrations apply honowarden --env production
```

Deploy:

```sh
pnpm wrangler deploy --env production
```

## Post-Upgrade Verification

- `GET /health`
- `GET /health/db`
- synthetic account login
- `GET /api/sync`
- refresh-token rotation
- TOTP challenge if TOTP is enabled for the synthetic account
- backup command dry-run still plans successfully

## Failure Handling

If Worker deploy fails before traffic is served, fix or redeploy the previous
commit.

If migration succeeds but Worker behavior fails, follow
[Rollback Guide](rollback-guide.md). Data rollback may require restore into fresh
D1/R2 resources rather than in-place reversal.
