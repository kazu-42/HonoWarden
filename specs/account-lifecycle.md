# Spec: Account Identity Change And Deletion Lifecycle

## Summary

HonoWarden supports owner-initiated email changes and a recoverable account
deletion lifecycle without exposing whether another email exists, invalidating
encrypted account state, orphaning organization data, or pretending that D1
and R2 can be mutated atomically.

The source capability is default-off. Deployment, real-account mutation,
irreversible purge, and outbound provider activation remain separate approval
gates.

## Pinned Compatibility Contract

- Official clients: `web-v2026.6.1` commit
  `39f07436ca60e3f25eac47777671754f288a98f1`.
- Official server: `v2026.6.1` commit
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Compatible routes:
  - authenticated `POST /api/accounts/email-token`
  - authenticated `POST /api/accounts/email`
  - authenticated `POST /api/accounts/verify-email`
  - anonymous `POST /api/accounts/verify-email-token`
  - authenticated `DELETE /api/accounts`
  - deprecated authenticated `POST /api/accounts/delete`
  - anonymous `POST /api/accounts/delete-recover`
  - anonymous `POST /api/accounts/delete-recover-token`

Official wire behavior is an input, not authority to weaken HonoWarden's
enumeration, audit, organization-isolation, retention, or recovery guarantees.

## Feature Gates And Dependencies

- `HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED=true` is required for every route and
  stays `false` in tracked top-level, staging, and production configuration.
- `HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET` is required when enabled and is
  never tracked or logged.
- `ACCOUNT_LIFECYCLE_MAILER` is a service binding that accepts a bounded,
  authenticated internal delivery request. A missing or failed mailer fails
  loudly; the API never returns a raw lifecycle token.
- The mailer must enqueue both `deliver` and `suppress` dispositions through
  the same bounded path, return exact `202` before provider delivery, never send
  a `suppress` request, and never log its request body. The API's equal HTTP
  status does not by itself prove equal latency; activation requires a synthetic
  timing-envelope test of the deployed mailer.
- Disabled routes, including Hono-derived `HEAD`, return a D1-free `501`.

## Inputs

### Email token request

- current credential proof in the pinned legacy or structured authentication
  shape
- `newEmail`: normalized strict email, at most 256 characters

### Email change confirmation

- current credential proof
- exact normalized `newEmail`
- one-time email-change token
- next client-derived authentication hash
- next wrapped user key
- unchanged supported KDF generation

### Email verification

- authenticated send request, or anonymous `{ userId, token }` confirmation

### Account deletion

- authenticated current credential proof, or anonymous
  `{ userId, token }` confirmation created by the generic delete-recover request
- request correlation ID and server timestamp

### Operator recovery and purge

- exact user ID
- reviewed lifecycle generation
- explicit reason and confirmation
- dry-run is the default

## Outputs

- Successful token-send routes return empty success and never the token.
- Unknown, duplicate, disabled, expired, consumed, or foreign-email token
  requests use bounded generic responses that do not disclose another account.
- Successful email change returns empty success, changes the login identity and
  credential generation atomically, and invalidates prior sessions.
- Successful account deletion request enters `recoverable` state and rejects
  all authentication without deleting encrypted data during the recovery
  window.
- Operator recovery returns the same lifecycle generation to `active` only
  before the cutoff.
- Irreversible purge produces a redacted plan/readback and leaves an opaque
  tombstone user row when organization-owned ciphertext still references the
  user identity.

## State Machines

### Email identity

1. `stable` -> `change_pending` after current-proof validation, uniqueness-safe
   token reservation, and accepted mail delivery.
2. `change_pending` -> `stable` after a one-time, generation-bound token changes
   email, authentication hash, wrapped user key, security stamp, revision,
   sessions, auth requests, and audit evidence in one D1 batch.
3. A newer request supersedes an older pending request. Expired, failed-delivery,
   or consumed requests cannot mutate the account.

### Account deletion

1. `active` -> `recoverable` after proof/token validation, last-owner safety,
   session invalidation, account disablement, recovery cutoff creation, and
   durable audit in one D1 batch.
2. `recoverable` -> `active` only through the dry-run-first operator recovery
   path before the exact cutoff.
3. `recoverable` -> `purge_ready` after the cutoff; no automatic destructive
   transition occurs.
4. `purge_ready` -> `purging_r2` -> `tombstoned` through an explicitly approved,
   retryable purge command.
5. Purge deletes only personal-vault R2 objects and personal rows. Organization
   ciphertext and organization-scoped attachments remain intact.

## Persistence Contract

- Lifecycle tokens store only a keyed token digest, purpose, user ID, target
  email digest/normalized value where required, credential generation, expiry,
  delivery state, consumed timestamp, and bounded metadata.
- Account deletion state stores user ID, lifecycle generation, state,
  requested/recover-until/purge timestamps, and redacted progress counters.
- The user row is not physically deleted while any organization-owned row may
  reference it. Finalization replaces identity and credential fields with
  irreversible opaque tombstone values.
- Audit rows contain user/target IDs, action, outcome, request ID, timestamp,
  lifecycle generation, and bounded counts/flags only. They never contain email,
  raw token, credential hash, wrapped key, R2 key, or encrypted payload.

## Transaction And Cross-Store Invariants

- Email change and recoverable deletion are generation-guarded D1 batches.
- Account deletion is rejected when the user is the last confirmed owner of any
  organization. Planning, purge preparation, R2 start, and final D1
  tombstoning recheck this invariant so recovery-window ownership changes fail
  closed.
- A user-owned organization cipher is not personal data solely because
  `ciphers.user_id` references that user; `organization_id` controls retention.
- D1 attachment metadata is retained until its personal R2 object deletion is
  confirmed. An R2 failure leaves a retryable state and never reports purge
  success.
- R2 deletion is idempotent. Final D1 tombstoning verifies the same lifecycle
  generation and exact remaining personal-object count.
- No code path uses `DELETE FROM users` as an account purge shortcut.

## Error Cases

- Invalid or stale credential proof: generic credential failure with existing
  proof defenses.
- Missing gate, token secret, or mailer: `501` while disabled; fail-loud `503`
  while enabled but misconfigured.
- Duplicate target email: generic accepted send response without a usable token.
- Stale/expired/consumed token or generation conflict: generic `400`/`409` with
  no partial mutation.
- Last confirmed organization owner: `409` without disablement or token
  consumption.
- D1 failure: `503`, durable state unchanged.
- R2 failure: purge remains retryable and D1 encrypted metadata is retained.
- Recovery after cutoff: fail closed without re-enabling the account.

## Acceptance Criteria

- [ ] Official request aliases and route status shapes are contract-tested.
- [ ] Feature gates are tracked default-off and disabled requests are D1-free.
- [ ] Tokens are one-time, short-lived, purpose-bound, user-bound,
      generation-bound, superseding, and never persisted or logged raw.
- [ ] Email uniqueness and change are atomic; prior login identity and sessions
      stop working after commit.
- [ ] Deletion cannot orphan a last-owner organization or delete organization
      ciphertext through the user foreign key.
- [ ] Recoverable disable, before-cutoff operator recovery, after-cutoff
      rejection, retryable R2 purge, and final tombstone are independently
      tested.
- [ ] Migration rollback/readback, redaction scans, local real-D1 lifecycle,
      full repository gates, independent review, PR/CI, merge/main, and Linear
      evidence are recorded.
- [ ] No production mutation, provider delivery, or compatibility promotion is
      claimed without separate live approval and evidence.

## Explicit Non-Goals

- Public registration or passwordless recovery.
- Organization ownership transfer in the deletion endpoint.
- Automatic irreversible deletion at the cutoff.
- Production deployment, real email delivery, real account mutation, or real
  vault deletion in the source-delivery lane.
