# Rollback Guide

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

Rollback separates Worker code rollback from data rollback. Do not assume schema
changes can be safely reversed in place.

## Decide Rollback Type

| Failure                                     | Preferred Action                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Worker deploy failed before serving traffic | redeploy previous known-good commit                                      |
| Worker serving errors with unchanged schema | redeploy previous known-good commit                                      |
| migration applied and new code is bad       | keep data target isolated, deploy compatible fix or restore fresh target |
| backup restore failed                       | discard restore target and rerun from the same backup                    |
| secrets exposed                             | rotate affected secrets and invalidate sessions where applicable         |

## Worker Code Rollback

1. Identify the previous known-good commit and CI run.
2. Check out that commit.
3. Confirm local gates still pass.
4. Deploy the previous Worker:

```sh
git checkout <previous-good-commit>
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
pnpm wrangler deploy --env production
```

5. Verify `/health`, `/health/db`, and synthetic login/sync.

## Data Rollback

There are no down migrations for alpha. Use fresh-target restore:

1. Stop writes to the affected environment if possible.
2. Create fresh D1 and R2 targets.
3. Restore the last known-good backup with `--confirm-fresh-target`.
4. Point Worker configuration to the restored targets.
5. Deploy Worker code compatible with the restored schema.
6. Verify health and synthetic sync.

Do not restore over the original source database during alpha.

## Secret Exposure Rollback

If a secret is exposed:

- `HONOWARDEN_TOKEN_SECRET`: rotate and force re-login; existing refresh-token
  hash lookups will fail after rotation.
- `HONOWARDEN_TOTP_SECRET`: rotate only with a TOTP re-enrollment plan; existing
  encrypted setup secrets cannot be decrypted by the new secret.
- `HONOWARDEN_BOOTSTRAP_TOKEN`: rotate immediately and keep bootstrap disabled.

## Evidence To Record

- incident start time and detection source
- affected commit and deploy command
- previous known-good commit
- CI run URLs
- migration versions before and after rollback
- backup manifest path if restore is used
- secret rotation actions
- final health and synthetic sync results
