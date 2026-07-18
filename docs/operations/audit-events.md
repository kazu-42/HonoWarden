# Audit Events

HonoWarden emits most structured JSON audit lines and persists their matching
D1 rows only when `HONOWARDEN_AUDIT_LOGS=true`. The default is `false` in all
Wrangler environments to keep local development quiet and avoid accidental log
volume. Credential-generation routes are the exception: their required,
secret-safe D1 audit row commits in the same transaction as the mutation even
when optional audit emission is disabled.

Audit events are designed to be secret-safe. Event builders drop context fields
whose keys contain sensitive fragments such as `password`, `token`, `secret`,
`hash`, `key`, `encrypted`, `payload`, or `body`.

## Event Shape

```json
{
  "object": "auditEvent",
  "schemaVersion": 1,
  "name": "device.revoke",
  "outcome": "success",
  "requestId": "request-id",
  "occurredAt": "2026-07-06T00:00:00.000Z",
  "actor": {
    "userId": "user-id",
    "deviceIdentifier": "device-id"
  },
  "target": {
    "type": "device",
    "id": "device-record-id"
  }
}
```

Fields:

- `object`: always `auditEvent`
- `schemaVersion`: currently `1`
- `name`: stable event name
- `outcome`: `success` or `failure`
- `requestId`: request correlation ID
- `occurredAt`: ISO timestamp from the Worker
- `actor`: user/device identifiers when safely known
- `target`: affected account, device, session, or backup target when safely known
- `context`: safe enum-like details only

## Implemented Events

- `admin.bootstrap`: successful restricted account bootstrap
- `account.security_stamp.rotate`: successful security-stamp generation
  rotation with all active account sessions and outstanding login-with-device
  authorizations revoked
- `auth.password_grant`: failed password-grant attempts after a request reaches
  credential validation
- `auth.refresh_reuse`: refresh token reuse detection
- `attachment.create`: successful encrypted attachment upload metadata creation
- `attachment.delete`: successful encrypted attachment metadata and object delete
- `backup.export`: user export success and database-failure outcomes, with
  count-only context and no request or response bodies
- `cipher.create`: successful cipher creation with type/favorite/folder flags
- `cipher.delete`: successful cipher trash mutation
- `cipher.permanent_delete`: successful permanent cipher deletion
- `cipher.restore`: successful cipher restore mutation
- `cipher.update`: successful cipher update with type/favorite/folder flags
- `device.revoke`: successful and not-found device revoke attempts
- `folder.create`: successful folder creation
- `folder.delete`: successful folder soft deletion
- `folder.update`: successful folder update
- `session.revoke_all`: successful revoke-all-other-sessions attempts
- `totp.change`: TOTP change start and verify outcomes
- `totp.disable`: successful and not-enabled TOTP disable attempts

## D1 Persistence

When optional audit logging is enabled, each built audit event is written to
`audit_events` after the console JSON line is emitted. Required credential
events instead write the same explicit columns inside the credential mutation
batch so an audit failure rolls back the mutation. Neither path stores a full
request, response, token, password hash, TOTP secret, plaintext IP address, raw
vault payload, or encrypted vault value.

Indexes support incident review by timestamp, event name, actor user, and
request ID:

- `idx_audit_events_occurred_at`
- `idx_audit_events_name_occurred`
- `idx_audit_events_actor_occurred`
- `idx_audit_events_request_id`

If `HONOWARDEN_AUDIT_LOGS=true` and D1 persistence fails, the request fails with
the same structured `database_unavailable` response used for other D1-backed
security paths. This is intentional: an operator must not receive a successful
security-sensitive response while the configured audit evidence sink silently
drops the row.

## Retention, Access, Export, And Deletion

Audit rows retain for 365 days. The scheduled Worker always deletes at most 100
expired `audit_events` rows per run so required credential events remain inside
that boundary even when optional audit logging is disabled. Password-grant
maintenance also deletes a bounded slice when optional audit logging is
enabled. Deletion is idempotent and ordered by `occurred_at` then `id` so
repeated cron executions drain old rows gradually.

Access is operator-only through Cloudflare D1 credentials. There is no public or
authenticated product API for audit search in the alpha scope.

For incident review, export only the columns needed for the incident window.
Keep `context_json` in the export only when the incident requires it:

```sql
SELECT
  id,
  name,
  outcome,
  request_id,
  occurred_at,
  actor_user_id,
  target_type,
  target_id,
  context_json
FROM audit_events
WHERE occurred_at >= '2026-07-09T00:00:00.000Z'
ORDER BY occurred_at ASC, id ASC
LIMIT 100;
```

Manual deletion should use the same retention boundary unless an incident
response or legal hold explicitly requires a narrower scope. Do not delete rows
by actor or target as a substitute for a reviewed retention decision.

## External Runtime Log Sink

Workers runtime logs and uncaught exception metadata are shipped separately from
D1 audit rows through Cloudflare Workers Trace Events Logpush. HON-49 selected a
dedicated R2 bucket, `honowarden-worker-logpush`, with job
`honowarden-workers-trace-events-to-r2` for `honowarden` and
`honowarden-staging`.

See [Log Retention Evidence](../release/log-retention-evidence.md) for the
redacted job readback, retention window, access model, and live smoke evidence.
Logpush is for runtime observability and incident review. It is not a substitute
for D1 `audit_events`, and it must not be used to record request bodies,
response bodies, tokens, passwords, decrypted vault data, encrypted vault
payloads, or private mailbox contents.

## Non-Goals In This Slice

- Logging request/response bodies
- Logging passwords, refresh tokens, token hashes, encrypted vault payloads, or
  vault item fields

## Operator Notes

Enable audit logging only in an environment whose log retention and access
controls are understood:

```sh
pnpm wrangler secret put HONOWARDEN_AUDIT_LOGS --env staging
```

Use `true` to enable and `false` to disable. Treat audit rows and logs as
sensitive operational metadata even though event builders omit known secret
fields. Apply `migrations/0007_audit_events.sql` before enabling audit logging
in an environment that should persist rows.

Operator backup and restore audit evidence is still runbook-based in the alpha
scope. Each backup/restore drill should record the manifest path, commands,
target resources, and verification result in the project update. The
`pnpm backup:export` and `pnpm backup:restore` commands print a secret-safe
`audit` packet with the action name, result status, and manifest SHA-256 id.
The packet does not include database names, bucket names, object keys, or
command arguments. The
user-triggered `POST /api/accounts/export` route emits the `backup.export`
Worker audit event and persists it to D1 when audit logging is enabled, but that
event is not a substitute for an operator disaster-recovery backup record.

Account lifecycle audit evidence is also runbook-based. `pnpm account:lifecycle`
prints a secret-safe packet with the action, reason, generated timestamp, target
hash, readback commands, mutation command, and rollback command. It is not a
persisted Worker audit event, and it must be attached to the approved Linear
issue or incident record after an executed disable/enable operation.
