# Audit Events

HonoWarden emits structured JSON audit lines only when
`HONOWARDEN_AUDIT_LOGS=true`. The default is `false` in all Wrangler
environments to keep local development quiet and avoid accidental log volume.

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
- `auth.password_grant`: failed password-grant attempts after a request reaches
  credential validation
- `auth.refresh_reuse`: refresh token reuse detection
- `backup.export`: user export success and database-failure outcomes, with
  count-only context and no request or response bodies
- `device.revoke`: successful and not-found device revoke attempts
- `session.revoke_all`: successful revoke-all-other-sessions attempts
- `totp.change`: TOTP change start and verify outcomes
- `totp.disable`: successful and not-enabled TOTP disable attempts

## Non-Goals In This Slice

- Persisting audit events to D1
- Shipping logs to a vendor-specific sink
- Logging request/response bodies
- Logging passwords, refresh tokens, token hashes, encrypted vault payloads, or
  vault item fields

## Operator Notes

Enable audit logging only in an environment whose log retention and access
controls are understood:

```sh
pnpm wrangler secret put HONOWARDEN_AUDIT_LOGS --env staging
```

Use `true` to enable and `false` to disable. Treat logs as sensitive operational
metadata even though event builders omit known secret fields.

Operator backup and restore audit evidence is still runbook-based in the alpha
scope. Each backup/restore drill should record the manifest path, commands,
target resources, and verification result in the project update. The
user-triggered `POST /api/accounts/export` route emits the `backup.export`
Worker audit event when audit logging is enabled, but that event is not a
substitute for an operator disaster-recovery backup record.

Account lifecycle audit evidence is also runbook-based. `pnpm account:lifecycle`
prints a secret-safe packet with the action, reason, generated timestamp, target
hash, readback commands, mutation command, and rollback command. It is not a
persisted Worker audit event, and it must be attached to the approved Linear
issue or incident record after an executed disable/enable operation.
