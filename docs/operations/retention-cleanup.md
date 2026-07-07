# Retention Cleanup

This runbook describes the alpha cleanup path for transient authentication
defense rows.

## Scope

The cleanup path covers:

- `auth_attempts`
- `auth_failure_buckets`
- `totp_challenges`

It does not delete users, devices, refresh tokens, folders, ciphers, audit log
lines, backup manifests, or R2 objects.

## Schedule

In the alpha implementation, cleanup is inline maintenance on the password-grant
token path. Each request with a valid `grant_type=password` form and device
identifier triggers one bounded cleanup slice before login-defense bucket
lookup.

There is no Cloudflare Cron Trigger yet. If password-grant traffic is absent,
stale transient rows can remain until the next password-grant request.

## Bounds

Each cleanup query deletes at most `100` rows per request. This keeps the hot
path bounded and lets repeated login traffic drain old rows gradually.

Retention rules:

- auth attempts older than the maximum login-defense window are eligible for
  deletion.
- auth failure buckets older than the maximum login-defense window are eligible
  only when they are not locked, or the lock has already expired.
- TOTP login challenges are eligible when they are expired or already consumed.

The queries are idempotent. Re-running a cleanup slice after all eligible rows
are gone deletes zero rows.

## Failure Behavior

Cleanup runs inside the same D1-backed token exchange path as login-defense
reads and writes. If cleanup fails, the password-grant request fails with the
same structured `database_unavailable` response used for token exchange
failures.

This is intentional for the alpha scope: a missing cleanup table or incompatible
schema means the deployed database is not at the expected migration level.

## Verification

Local checks:

```sh
pnpm test -- test/repositories/auth-repository.test.ts test/repositories/totp-repository.test.ts
pnpm test -- test/app.test.ts
pnpm check
pnpm lint
pnpm format
```

The repository tests assert that cleanup is bounded, idempotent, and does not
delete active login-defense buckets.

## Future Scheduled Job

A future production hardening slice can move the same repository cleanup
functions behind a Cloudflare Cron Trigger. That should add:

- a dedicated maintenance route or scheduled Worker handler
- deployment evidence for the trigger
- metrics for rows deleted and cleanup failures
- explicit indexes if production row counts justify them
