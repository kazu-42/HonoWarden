# User-Key ID Registration

Scope: local implementation and synthetic verification only. This does not
authorize a migration, deployment, or writer activation in staging/production.

## Contract

`POST /api/accounts/key-management/user-key-id` accepts a JSON object containing
`userKeyId`: exactly 32 lowercase ASCII hexadecimal characters (16 bytes).
The Pascal-case alias is accepted; conflicting aliases and unknown fields are
rejected. The body limit is 1,024 bytes. IDs are client-derived metadata, not
key material; the server cannot verify their cryptographic derivation and must
not infer them from an encrypted wrapper.

The route is disabled unless `HONOWARDEN_USER_KEY_ID_ENABLED=true`. All tracked
environments retain `false`. Disabled GET/HEAD/POST requests return no-store
501 without accessing D1, including when request quotas are enabled. Enabled
GET/HEAD requests return 405 with `Allow: POST`.

An authenticated bearer token selects the owner; no owner ID is accepted from
the body. Successful registration returns an empty no-store 200. Missing or
invalid authorization returns 401; malformed, already-registered, or raced
requests return 400; infrastructure/audit failures return 503. Duplicate
registration is not a success-shaped no-op.

## Persistence And Concurrency

Migration `0022_user_key_id.sql` adds nullable `users.user_key_id` with a
canonical-format CHECK. Existing rows remain NULL. No backfill is performed
by the migration, and no additional index is needed: writes use the user PK.

Registration conditionally updates only an enabled owner's NULL ID, matching
the authenticated snapshot's security stamp, encrypted user key, and revision.
The revision advances monotonically. The required
`account.user_key_id.register` audit row is inserted in the same D1 batch only
when the UPDATE changed one row. Audit failure rolls the entire batch back;
concurrent or same-millisecond retries cannot overwrite the ID or add another
success audit. No ID, key material, or body is included in audit context or logs.

Sync returns the registered ID at `userDecryption.userKeyId`. This is the
field consumed by the exact CLI 2026.9.0 SDK bridge; putting it only in the
master-password unlock object does not prevent duplicate backfill. Unlock
responses also carry `containedKeyId` alongside the corresponding wrapped key.

Rotation accepts optional `newUserKeyId`, validates its format, rejects reuse
of the current ID, and sets the new ID atomically with the generation. Legacy
rotation requests without the field clear it. A database trigger also clears
an unchanged ID when any older writer replaces `user_key`. This deliberately
includes password/KDF rewraps: a conservative client re-backfill is preferable
to silently carrying stale metadata through an old writer or binary rollback.

## Rollout And Recovery

Schema must precede the new application: authentication SELECTs require the
new column even while the writer flag is off. A missing migration fails loudly;
there is no schema-error fallback. Keep the column and trigger on application
rollback. Disabling the registration flag prevents new registrations but does
not make latest-client compatibility pass for accounts still missing an ID.
Do not drop the column, disable the invalidation trigger, restore old vault
generations, or alter remote resources as an automatic recovery step.

Tests cover canonical input, authentication, disabled no-D1 behavior, mandatory
audit rollback, single-winner concurrency, stale generation rejection, sync
projection, and new/legacy rotation ID coherence. Exact native-client evidence
and its narrower acceptance scope are recorded separately in
[the current CLI smoke evidence](../release/current-cli-2026-9-smoke.md).
