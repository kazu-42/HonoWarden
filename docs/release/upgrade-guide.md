# Upgrade Guide

Target: `v0.1.0-alpha`.

Last updated: 2026-08-09.

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
- `0015_webauthn.sql` must be applied before deploying a Worker that imports the
  WebAuthn credential or challenge repository. Keep
  `HONOWARDEN_WEBAUTHN_ENABLED=false` at every tracked scope. The migration
  creates `webauthn_credentials` and `webauthn_challenges` only; it does not
  mount routes, advertise a passkey feature, or consume a challenge. Verify
  `/health/db` reports both tables before any later ceremony work. Rollback
  disables enablement and never un-consumes a challenge, restores a deleted
  credential, or rolls a sign counter backward.
- `0016_user_key_rotation_wrapper_history.sql` must be applied before deploying
  the Worker commit that records account-key initialization, password, KDF, and
  user-key wrapper history. The migration and canonical fingerprint writer are
  introduced in the same release; no earlier release writes this new table.
  Drain credential mutation requests across the migration/Worker activation
  window. Keep `HONOWARDEN_PASSWORD_CHANGE_ENABLED=false`,
  `HONOWARDEN_ACCOUNT_KEYS_ENABLED=false`,
  `HONOWARDEN_KDF_MUTATION_ENABLED=false`, and
  `HONOWARDEN_USER_KEY_ROTATION_ENABLED=false` until `/health/db` reports the
  table, complete readers have been exercised, and a reader-capable rollback
  Worker has been recorded. Enable writers only in a later reviewed rollout;
  disable all four again before rollback. The migration
  cannot reconstruct wrappers superseded before `0016`.
- `0017_account_lifecycle.sql` must be applied before deploying a Worker that
  can serve account email-change, email-verification, recoverable deletion, or
  purge operations. Keep `HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED=false` at every
  scope while applying the migration and deploying the complete lifecycle
  reader/operator surface. Verify `/health/db`, the `email_verified_at`
  backfill, and both lifecycle tables before any later activation. The tracked
  configuration remains default-off, and activation requires a separately
  reviewed mailer service binding, a 32-byte-or-longer lifecycle token secret,
  synthetic environment evidence, and an operator rollback decision. Never
  enable the feature before the named `AccountLifecycleOperator` entrypoint and
  retryable purge reader are deployed: a pre-reader Worker cannot safely
  recover or finish an account already placed into lifecycle state.
- `0018_text_sends.sql` is an additive reader-first migration for encrypted
  text Send state. Apply it before deploying any Worker that imports the Send
  repository or owner application service. Keep `send-enabled: false`, retain
  the explicit `/api/sends*` and `send_access` `501` guards, and do not install
  capability-envelope or lookup-verifier secrets during this source-only
  slice. Route activation requires the later full Send gate, including both
  independent versioned roots, quota and cleanup readiness, compatibility
  tests, and a reader-capable rollback Worker. Verify `/health/db` plus the
  `sends` table and both `idx_sends_*` indexes before any separately approved
  rollout.
- `0019_send_files.sql` is an additive reader-first migration for encrypted
  file Send metadata, encrypted file names, generation-bound private object
  keys, and download-ticket verifiers. Apply it before deploying any Worker that imports the file Send
  repository. Keep `send-enabled: false` and the explicit `/api/sends*` `501`
  guards. Do not install Send keyrings, expose R2, or activate public download
  during this source-only slice. Verify `/health/db` plus the `send_files` and
  `send_download_tickets` tables before any separately approved rollout.
- `0020_personal_api_keys.sql` is an additive reader-first migration for
  personal API-key verifiers. Apply it before deploying any Worker that imports
  the personal API-key repository. Keep
  `HONOWARDEN_PERSONAL_API_KEYS_ENABLED=false` and do not install
  `HONOWARDEN_API_KEY_SECRET` during this source-only slice. Organization API
  credentials remain `501`. Verify `/health/db` plus the `personal_api_keys`
  table before any separately approved rollout.
- Do not edit an already-applied migration file.
- Add forward-only migrations for future schema changes.
- Update `docs/release/migration-freeze.md` in the same change when migrations
  are added.

## Upgrade Steps

Status: **REAL WORKER/VERSION/TRAFFIC WRITE STOP**. Prepare the upgrade from a
dedicated exact reviewed commit, but do not provide credentials to the static
deploy or staging dry-run blockers. This repository has no remote migration,
upload, activation, or recovery execution protocol. Direct Wrangler use is not
an approved fallback. Migration, binding, route, cron, traffic, and every other
non-versioned setting require separately reviewed authority, pre/post readback,
partial-success classification, and recovery.

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

Remote migrations and deployment remain STOP until that execution protocol is
reviewed and authorized for the exact environment.

## Post-Upgrade Verification

- `GET /health`
- `GET /healthz`
- `GET /health/db`
- `GET /api/config`
- synthetic account login
- `GET /api/sync`
- refresh-token rotation
- TOTP challenge if TOTP is enabled for the synthetic account
- backup command dry-run still plans successfully

Verify both health aliases report the intended `environment`, a distinct
`workerVersionId`, a valid `createdAt`, and the exact upgrade commit in
`build.gitSha`. `/api/config.gitHash` must equal that SHA. Any mismatch is a
**STOP** and the resulting Worker version must not be used as a promotion or
rollback target.

## Failure Handling

If Worker deploy fails before traffic is served, fix or redeploy the previous
commit.

If migration succeeds but Worker behavior fails, follow
[Rollback Guide](rollback-guide.md). Data rollback may require restore into fresh
D1/R2 resources rather than in-place reversal.
