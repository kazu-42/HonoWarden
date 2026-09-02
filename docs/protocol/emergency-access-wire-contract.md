# Emergency Access Wire, Identity, And State Contract

## Status

Approved by HON-188 as the implementation contract for later Emergency Access
slices. Nothing in this document changes current runtime behavior. Until
HON-191's full activation gate passes, every `/api/emergency-access` route
remains an explicit `501 unsupported_feature`.

Normative terms `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe future
implementation requirements. They are not current capability claims.

## Reproducible Compatibility Baseline

The route and field inventory was read from public, pinned official sources.
Tracked references deliberately use generic source labels rather than provider
branding.

| Source          | Tag             | Commit                                     | Relevant paths                                                                                                                                                                                                                     |
| --------------- | --------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| official client | `web-v2026.6.1` | `39f07436ca60e3f25eac47777671754f288a98f1` | `apps/web/src/app/auth/emergency-access/services/emergency-access-api.service.ts`; `apps/web/src/app/auth/emergency-access/request/`; `apps/web/src/app/auth/emergency-access/enums/emergency-access-status-type.ts`               |
| official server | `v2026.6.1`     | `a09c7edb03ae6d4fdece784f1250c67be73d5fe0` | `src/Api/Auth/Controllers/EmergencyAccessController.cs`; `src/Core/Auth/UserFeatures/EmergencyAccess/EmergencyAccessService.cs`; `src/Core/Auth/Enums/EmergencyAccessStatusType.cs`; `src/Sql/dbo/Auth/Tables/EmergencyAccess.sql` |

Any later source upgrade requires a recorded diff of route, field, enum, token,
wait-time, notification, and cryptographic-handoff semantics before
implementation is changed.

## Protocol Conventions

- API routes are shown with HonoWarden's `/api` prefix. The pinned client calls
  `/emergency-access/...`; HonoWarden serves the same paths under `/api`.
- JSON request names are accepted case-insensitively according to the existing
  protocol parser. Responses use the official-client property shape.
- Dates are UTC RFC 3339 strings. Wait-time arithmetic uses D1 UTC timestamps,
  never a client clock.
- `Type`: View `0`, Takeover `1`.
- `Status`: Invited `0`, Accepted `1`, Confirmed `2`, RecoveryInitiated `3`,
  RecoveryApproved `4`.
- IDs are opaque. Grantor and grantee user ids are different values from the
  emergency-access relationship id.
- Every response has a request ID. Cross-owner and unknown ids are identical
  generic failures.
- Before activation, `/api/config`, `/config`, Emergency Access `501` guards,
  and future `503` readiness failures use `Cache-Control: no-store`.

## Authoritative State Machine

The Worker MUST persist one relationship row per grantor/grantee (or
grantor/email while invited) with `status`, `type`, `wait_time_days`,
`key_encrypted`, `key_generation`, `recovery_initiated_at`,
`last_notification_at`, and `revision`. Status changes MUST use a
`conditional UPDATE` whose predicate includes the expected status, actor, and
current key generation. Read-then-write is forbidden.

```
Invited
  -- accept (grantee + valid invite token + recipient email) --> Accepted
  -- delete (grantor) --> terminal
Accepted
  -- confirm (grantor + opaque KeyEncrypted for current key generation) --> Confirmed
  -- delete (grantor or grantee) --> terminal
Confirmed
  -- initiate (grantee) --> RecoveryInitiated
  -- update type/wait (grantor; wait cannot shorten an in-flight recovery)
  -- delete (grantor or grantee) --> terminal
RecoveryInitiated
  -- approve (grantor) --> RecoveryApproved
  -- timeout (server-authoritative RecoveryInitiatedDate + wait time) --> RecoveryApproved
  -- reject (grantor) --> Confirmed
  -- delete --> terminal
RecoveryApproved
  -- view / attachment (grantee AND Type=View AND current key generation)
  -- takeover / password / policies (grantee AND Type=Takeover AND current key generation)
  -- reject (grantor) --> Confirmed
  -- delete --> terminal
```

The design requires no path that skips identity proof, confirmation,
wait/approval, or current key-generation checks:

- Invite and accept are identity proof. An invite token is single-use, expiring,
  bound to the relationship id and recipient email, and unusable after delete.
- Confirm is the cryptographic handoff. `KeyEncrypted` is absent until confirm.
  Invited or accepted rows MUST NOT initiate, view, takeover, or return keys.
- Initiate is the only entry to the wait. Approve and timeout are the only
  entries to `RecoveryApproved`. View/takeover MUST NOT run from `Confirmed`.
- Current key generation is rechecked on confirm, initiate, approve, timeout,
  view, attachment, takeover, and password. A rotated grantor key without a
  matching rewrap fails closed.

Repeated initiate MUST NOT shorten an accepted wait. Concurrent approve, reject,
and timeout MUST produce exactly one winner. Failed verification changes no
status, key material, or generation.

## Identity And Invitation

`POST /api/emergency-access/invite` requires the grantor's account bearer token.
The body is `{ "email", "type", "waitTimeDays" }`. The grantor MUST NOT invite
their own email. `WaitTimeDays` is an integer of at least one day. Later slices
MAY apply a documented ceiling that still accepts the pinned client's offered
values. Type MUST be View or Takeover.

The Worker creates an `Invited` row, then attempts out-of-band delivery of a
protected invite token. Token validity is independent of whether the email was
accepted by a mail provider. Reinvite (`POST /api/emergency-access/:id/reinvite`)
is allowed only while `Invited` and mints a new token that invalidates the
previous one.

`POST /api/emergency-access/:id/accept` requires the grantee's bearer token and
`{ "token" }`. Accept succeeds only when the token is valid, unexpired, unused,
bound to that id, and the authenticated account email equals the invited
recipient email. On success the row becomes `Accepted`, stores `GranteeId`, and
clears the invite email field. Wrong-recipient, replay, and cross-user tokens
fail closed with a generic error.

The compatible invitation proof expires after five days, matching the pinned
tokenable's organization-invite hour window. Expiry invalidates the token; it
does not auto-confirm or auto-delete the row.

## Confirmation And Opaque Key Material

`POST /api/emergency-access/:id/confirm` requires the grantor and
`{ "key": "<opaque KeyEncrypted>" }`. The server MUST NOT parse, decrypt, or
infer content from that string. It stores the value as opaque ciphertext bound
to the grantor's current key generation. Confirm is allowed only from
`Accepted`.

`KeyEncrypted` is the grantor's user symmetric key wrapped to the grantee's
account public key on the client. The Worker never receives the grantee's
private key, PRF output, or plaintext vault key. Logs, metrics, audit, and
evidence MUST NOT include `KeyEncrypted`, invite tokens, ciphertext, or
plaintext emails beyond bounded identity hashes.

Account-key rotation currently requires `emergencyAccessUnlockData` to be empty.
Until HON-191, that remains the fail-closed contract. After HON-191, rotation
MUST include a rewrap for every confirmed relationship or fail. View, takeover,
and password MUST compare the stored key generation to the grantor's current
generation and fail if they differ.

Takeover type is incompatible with any future Key Connector or organization
automatic-confirmation policy. Requests that would create that combination fail
atomically.

## Delayed Request, Approval, And Rejection

`POST /api/emergency-access/:id/initiate` requires the bound grantee and
`Confirmed` status. It writes `RecoveryInitiated`, `RecoveryInitiatedDate`, and
`LastNotificationDate` in one conditional UPDATE, then enqueues notification.
Client-supplied remaining-wait values are ignored. Clock skew is at most thirty
seconds for any timestamp comparison; wait expiry uses D1 UTC
`DATEADD(DAY, WaitTimeDays, RecoveryInitiatedDate) <= now`.

`POST /api/emergency-access/:id/approve` requires the grantor and
`RecoveryInitiated`. It writes `RecoveryApproved`.

`POST /api/emergency-access/:id/reject` requires the grantor and either
`RecoveryInitiated` or `RecoveryApproved`. It returns the row to `Confirmed`,
clears recovery timestamps, and immediately ends view/takeover authority.
Reject is the compatible cancellation of an in-flight or granted recovery
without deleting the trusted contact.

A scheduled timeout job selects `Status = RecoveryInitiated` rows whose wait
has elapsed and conditionally updates them to `RecoveryApproved`. Job failure,
duplicate delivery, or clock skew MUST NOT grant early. Missed jobs are
reconciled by the next run using the original `RecoveryInitiatedDate`; they do
not reset the wait.

## Notification Contract

Notification is out-of-band. The Worker MAY send invite, accepted, confirmed,
recovery-initiated, daily reminder, approved, timed-out, and rejected messages.
`LastNotificationDate` records reminder attempts only and MUST NOT change
`Status`.

Notification loss never grants access. A lost invite mail does not accept. A
lost recovery mail does not approve. A lost reminder does not skip the wait. A
lost approval mail does not create takeover material.

Notification success alone never advances authoritative state. Mail-provider
`250`, push ACK, or in-app display MUST NOT write `Status`. Authoritative
transitions complete in D1 first; delivery is retried from a durable attempt
row. Ambiguous provider results are failures, not grants. Delivery adapters
MUST redact tokens, keys, and ciphertext.

## Lists, Update, Delete, And Policy Reads

### `GET /api/emergency-access/trusted`

Grantor list of contacts the caller has invited. Returns authorized metadata
and current lifecycle state only. It MUST NOT include another user's rows or
`KeyEncrypted`. This is the pinned client's key-rotation preflight. Until
activation it remains `501`, not an empty list.

### `GET /api/emergency-access/granted`

Grantee list of grantors who designated the caller. Same redaction rules.

### `GET /api/emergency-access/:id`

Grantor-scoped details or generic failure.

### `PUT /api/emergency-access/:id` and obsolete `POST /api/emergency-access/:id`

Grantor update of `Type` and `WaitTimeDays`. Optional `keyEncrypted` may replace
opaque material only when the row is already confirmed and the caller supplies a
current-generation wrap. Update MUST NOT confirm an unconfirmed row, MUST NOT
shorten an in-flight wait below the already elapsed server time, and MUST NOT
change actor bindings.

### `DELETE /api/emergency-access/:id` and obsolete `POST /api/emergency-access/:id/delete`

Grantor or grantee may delete. Delete is terminal, invalidates invite tokens,
and ends view/takeover. Audit evidence is retained according to the metadata
policy.

### `GET /api/emergency-access/:id/policies`

Takeover + `RecoveryApproved` only. HonoWarden personal vaults return an empty
policy list. Organization policy enforcement is out of scope and MUST NOT be
approximated.

## View, Attachment, Takeover, And Password

### `POST /api/emergency-access/:id/view`

Requires grantee, `Type=View`, `RecoveryApproved`, and current key generation.
Returns `{ "KeyEncrypted", "Ciphers", "Object": "emergencyAccessView" }` where
ciphers are the grantor's personal opaque records only. Organization ciphers
MUST NOT be included. View-only MUST NOT mutate the grantor account or return
takeover password material.

### `GET /api/emergency-access/:id/:cipherId/attachment/:attachmentId`

Same View + `RecoveryApproved` + current key generation checks. Returns an
attachment download descriptor for a grantor personal cipher. After activation,
unknown ids are generic `404`; `404` MUST NOT be used as the unsupported-feature
signal (ADR 0009). The Worker streams or tickets the existing cipher-attachment
object; it MUST NOT decrypt it.

### `POST /api/emergency-access/:id/takeover`

Requires grantee, `Type=Takeover`, `RecoveryApproved`, and current key
generation. Returns opaque `KeyEncrypted` plus grantor KDF parameters
(`Kdf`, `KdfIterations`, `KdfMemory`, `KdfParallelism`, `Salt`). It MUST NOT
return View cipher lists.

### `POST /api/emergency-access/:id/password`

Requires the same Takeover gate. The pinned client currently sends
`newMasterPasswordHash` and `key`; a newer body may send `UnlockData` and
`AuthenticationData`. Either form replaces the grantor's master-password wrap,
clears two-step login and new-device verification, and is a security-stamp
event. The server never receives a plaintext master password. Takeover MUST NOT
access a different key generation or a foreign attachment.

## Abuse, Audit, Retention, And Activation

Invite and initiate consume grantor/grantee/account buckets plus a
relationship-scoped initiate quota. Accept token failures consume a stricter
bucket. Quota exhaustion returns `429` with `Retry-After` and no existence
oracle. Cross-user id guessing is generic.

Audit is allowlist-based: event type, request ID, actor role, relationship id,
status transition, type, generation, result class, and timestamps. Audit
redaction MUST remove invite tokens, `KeyEncrypted`, ciphertext, attachment
URLs, raw emails, and request bodies.

Invite tokens expire in five days. Reminder and attempt rows use short
documented windows. Relationship rows persist until delete. Deleted payload
follows the existing 365-day metadata audit policy; opaque keys are removed
with the row. Backup residual MAY retain encrypted rows for the existing backup
window; restore MUST NOT activate Emergency Access while traffic is enabled.

`HONOWARDEN_EMERGENCY_ACCESS_RUNTIME_ENABLED` is default-off and out-of-band
from D1. The kill switch independently disables new initiate/approve/timeout
and all view/takeover routes without deleting audit evidence. Rollback is
setting that gate false, setting the kill switch, and reading back `501` or
`503` plus rejected view/takeover.

## Error Matrix

| Surface                         | Client error        | Infrastructure failure | Notes                                   |
| ------------------------------- | ------------------- | ---------------------- | --------------------------------------- |
| unsupported / pre-activation    | `501`               | n/a                    | ADR 0009 shape with top-level `Message` |
| validation                      | `400`               | `503`                  | no key material in the body             |
| unknown / cross-user            | generic `404`/`400` | `503`                  | identical external shape                |
| invite/initiate quota           | `429` + Retry-After | `503`                  | no existence detail                     |
| view/takeover wrong status/type | generic failure     | `503`                  | never return the other type's payload   |
| stale key generation            | generic failure     | `503`                  | fail closed; do not serve old wraps     |
| notification adapter            | n/a                 | retry + alert          | does not roll back D1 status            |

## Required Test Matrix For Later Slices

Later slices cannot claim source-ready without tests for:

- trusted/granted isolation and empty-list-versus-`501` distinction;
- invite/accept/confirm identity proof, token replay, wrong recipient, and
  five-day expiry;
- no initiate from Invited/Accepted; no view from Confirmed;
- approve/reject/timeout single-winner conditional UPDATE;
- wait not shortened by re-initiate, client clocks, or notification failure;
- notification retry without status writes;
- View cannot takeover; Takeover cannot view foreign attachments;
- current key-generation mismatch fails closed;
- delete/reject/disable/kill switch invalidate future access;
- audit redaction of tokens, keys, and ciphertext;
- pinned official-client synthetic lifecycle on an exact deployed commit.
