# Send Wire, State, And Storage Contract

## Status

Approved by HON-183 as the implementation contract for later Send slices.
Nothing in this document changes current runtime behavior. Until HON-186's full
activation gate passes, every Send route and `send_access` remains an explicit
`501 unsupported_feature`, and config remains `send-enabled: false`.

Normative terms `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe future
implementation requirements. They are not current capability claims.

## Reproducible Compatibility Baseline

The route and field inventory was read from public, pinned official sources.
Tracked references deliberately use generic source labels rather than provider
branding.

| Source          | Tag             | Commit                                     | Relevant paths                                                                                                                                                                                                                                                                                                                             |
| --------------- | --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| official client | `web-v2026.6.1` | `39f07436ca60e3f25eac47777671754f288a98f1` | `libs/common/src/tools/send/services/send-api.service.ts`; `libs/common/src/tools/send/models/request/send.request.ts`; `libs/common/src/auth/send-access/services/default-send-token.service.ts`; `libs/common/src/key-management/sends/services/default-send-password.service.ts`; `apps/cli/src/tools/send/commands/receive.command.ts` |
| official server | `v2026.6.1`     | `a09c7edb03ae6d4fdece784f1250c67be73d5fe0` | `src/Api/Tools/Controllers/SendsController.cs`; `src/Api/Tools/Models/Request/SendRequestModel.cs`; `src/Core/Tools/Entities/Send.cs`; `src/Core/Tools/SendFeatures/Commands/NonAnonymousSendCommand.cs`; `src/Identity/IdentityServer/RequestValidators/SendAccess/`                                                                      |

Any later source upgrade requires a recorded diff of route, field, enum, token,
credential, access-count, and file-transfer semantics before implementation is
changed.

## Protocol Conventions

- API routes are shown with HonoWarden's `/api` prefix. Identity uses
  `/identity/connect/token`.
- JSON request names are accepted case-insensitively according to the existing
  protocol parser. Responses use the official-client property shape.
- Dates are UTC RFC 3339 strings. Deletion is required, must be in the future,
  and must be no more than 31 days ahead at each accepted create/update.
  Expiration is optional and cannot exceed deletion.
- `Type`: text `0`, file `1`.
- `AuthType`: email `0`, password `1`, none `2`. Email is a known wire value but
  email OTP creation remains explicitly unsupported until its separate design.
- IDs are opaque. Owner `Id` and public `AccessId` are different values. No route
  may accept an R2 object key from a client.
- Every response has a request ID. Public errors contain no owner, object, state,
  time, count, or existence detail.
- Public/token/download responses use `Cache-Control: no-store, private` and
  `Pragma: no-cache`. Owner mutation responses use `Cache-Control: no-store`.
- Before public activation, `/api/config`, `/config`, Send `501` guards, and
  future Send `503` readiness failures use `Cache-Control: no-store`; gateway
  caching is disabled and verified independently of response headers.

## Public Link And Cryptographic Boundary

The compatible link is `https://{web-origin}/#/send/{accessId}/{urlB64Key}`.
Both values begin inside the URL fragment and are not transmitted by the browser
in its initial HTTP request. The client parses them locally:

- `accessId` becomes the send id supplied to token or legacy API calls;
- `urlB64Key` remains client-side key material for Send encryption/decryption and
  password derivation.

The Worker never receives plaintext names, notes, text, filenames, file bytes,
passwords, or the raw URL fragment key. `Name`, `Notes`, `Key`, `Text.Text`, and
`File.FileName` are opaque ciphertext. R2 stores only the encrypted file body.

Owner list/get/create responses return the raw access capability because the
owner client must construct or recover a link. D1 stores an AEAD encrypted
capability envelope for owner-only recovery plus a purpose-separated keyed
verifier for indexed public lookup. The raw value MUST NOT appear in plaintext
in D1, logs, metrics, audit, abuse reports, queue keys, or object names. A D1-only
disclosure does not recover it.

`HONOWARDEN_SEND_CAPABILITY_ENVELOPE_SECRET` and
`HONOWARDEN_SEND_LOOKUP_VERIFIER_SECRET` are independent versioned roots. The
first encrypts owner-recoverable capabilities; the second derives lookup,
password-verifier, deterministic-decoy, audit, and quota keys under distinct
labels. D1 plus the active envelope root can recover every capability encrypted
under it. Containment requires both kill gates, independent keyring rotation,
capability/verifier regeneration for every surviving Send, access-generation
invalidation, and treating prior links as exposed.

## Owner Request Object

Text create and update use this logical object. File create adds `FileLength`
and `File` instead of `Text`.

```json
{
  "Type": 0,
  "Name": "opaque-encrypted-string",
  "Notes": "opaque-encrypted-string-or-null",
  "Key": "owner-encrypted-send-key",
  "MaxAccessCount": 5,
  "ExpirationDate": "2026-07-20T00:00:00.000Z",
  "DeletionDate": "2026-07-25T00:00:00.000Z",
  "Text": {
    "Text": "opaque-encrypted-string",
    "Hidden": false
  },
  "Password": "client-hash-or-null",
  "Emails": null,
  "Disabled": false,
  "HideEmail": false,
  "AuthType": 1
}
```

Validation rules:

- Exactly one of `Text` or `File` matches `Type`.
- `Name`, `Notes`, `Key`, and nested encrypted fields have bounded encoded byte
  lengths; validation never parses ciphertext.
- `MaxAccessCount`, when present, is an integer of at least one and cannot be
  reduced below the already consumed count.
- `Password` is required only for password auth and is the client-derived hash,
  never plaintext. It is absent for none auth.
- `Emails` and email auth fail atomically as unsupported in the initial slices.
- `Disabled`, dates, type, and auth type are required even if a client omits
  optional encrypted fields.
- Unknown fields are ignored only where current protocol parsing already does
  so; security-relevant enum values and structurally inconsistent type payloads
  are rejected with `400`.
- A file length is checked before the request body is accepted against per-file,
  owner aggregate-byte, owner active-count, and environment hard quotas.

## Owner Response Object

Owner get/create/update responses expose only the owner's record:

```json
{
  "Id": "owner-send-id",
  "AccessId": "raw-public-capability",
  "Type": 0,
  "AuthType": 1,
  "Name": "opaque-encrypted-string",
  "Notes": "opaque-encrypted-string-or-null",
  "Text": { "Text": "opaque-encrypted-string", "Hidden": false },
  "File": null,
  "Key": "owner-encrypted-send-key",
  "MaxAccessCount": 5,
  "AccessCount": 0,
  "RevisionDate": "2026-07-19T00:00:00.000Z",
  "ExpirationDate": "2026-07-20T00:00:00.000Z",
  "DeletionDate": "2026-07-25T00:00:00.000Z",
  "Password": "configured",
  "Emails": null,
  "Disabled": false,
  "HideEmail": false,
  "Object": "send"
}
```

`Password` is a string-shaped non-secret presence marker (`"configured"`) needed
by current owner clients, not a verifier. When existing and requested auth types
remain password, update ignores that marker and retains the current verifier;
password replacement uses the explicit remove-then-set flow. A response MUST NOT
return the client hash or server keyed verifier. `AccessId` is owner-only and
must not be included in list logs or public responses.

## Owner Route Inventory

### `GET /api/sends`

Requires an account bearer token. Returns the owner's non-deleted Sends in the
existing list envelope. It MUST NOT include another user's rows or physical
tombstones. Expired rows MAY remain visible to the owner until deletion, matching
the owner control-plane role. `200`, no-store.

### `GET /api/sends/:id`

Requires owner scope in the D1 predicate. Returns the owner response or generic
`404`. A cross-owner ID and unknown ID are identical. `200` or `404`, no-store.

### `POST /api/sends`

Creates a text Send only. Server actions in one D1 transaction:

1. validate owner/account quotas and request shape;
2. generate owner ID and independent 16-byte CSPRNG access capability;
3. persist the encrypted capability envelope plus capability/password verifiers
   with key versions;
4. insert an `active` text row with access generation `1`;
5. insert a redacted audit event when required;
6. return `201` with the owner response and raw `AccessId`.

An optional `Idempotency-Key` extension MAY deduplicate an identical owner retry
for a short window. Official clients do not send it, so callers cannot assume a
network-retried create is automatically unique.

### `POST /api/sends/file/v2`

Creates file metadata in `pending_upload`. It MUST NOT create an active public
Send. The response has `FileUploadType`, nested `SendResponse`, and optional
`Url`. HonoWarden selects compatible direct upload mode (`FileUploadType: 0`)
and does not expose or presign R2. Upload renewal returns the same protected
direct route contract.

```json
{
  "FileUploadType": 0,
  "SendResponse": { "Id": "owner-send-id", "AccessId": "capability" },
  "Url": null
}
```

### `GET /api/sends/:sendId/file/:fileId`

Renews upload authorization only for the owner, matching file ID, current
`pending_upload` generation, unexpired upload deadline, and not-yet-validated
object. It never renews an active, deleted, stale-generation, or cross-owner
upload. `200`, `404`, `409`, or `410`, no-store.

### `POST /api/sends/:sendId/file/:fileId`

Accepts the compatible direct multipart encrypted file body. Authentication and
all metadata/size/quota checks occur before streaming. The server writes only to
the generation-specific private R2 key. After put, it verifies object identity
and expected size, then performs this logical compare-and-set:

```sql
UPDATE send_files
SET state = 'active', validated_at = ?, object_etag = ?
WHERE send_id = ?
  AND file_id = ?
  AND owner_user_id = ?
  AND object_generation = ?
  AND state = 'pending_upload'
RETURNING send_id, file_id, object_generation;
```

No returned row means the object is inaccessible and scheduled for generation-
safe orphan cleanup. It is never attached to a newer generation. `201`/`204` on
activation; typed `4xx` for shape/size/state; `503` for storage infrastructure.

### `PUT /api/sends/:id`

Requires an owner-scoped non-tombstoned row. Updates compatible metadata and
increments `access_generation` for every security-relevant change, including
credential, disable, expiry, deletion, maximum count, or encrypted payload.
Update cannot change owner, public capability, immutable type, file ID, or R2
`object_generation`. A deleted row cannot be resurrected. `200`, `400`, `404`,
or `409`.

### `PUT /api/sends/:id/remove-password`

Requires owner scope. This official-client compatibility alias delegates to the
same remove-all-auth operation as `remove-auth`. It removes the password
verifier and any deferred email-auth state, changes auth type to none in one
transaction, increments `access_generation`, and invalidates every prior Send
token. It returns the owner response. Repeating it is idempotent for an existing
owner row. `200` or `404`.

### `PUT /api/sends/:id/remove-auth`

Requires owner scope and is the official-server alias for removing every Send
authentication method. The initial product slices cannot create email auth, so
its observable effect matches `remove-password`; keeping the alias in the wire
inventory prevents a later email-auth slice from diverging. It uses the same
transaction, generation invalidation, idempotency, response, and error contract.

### `DELETE /api/sends/:id`

Requires owner scope. It first writes a tombstone, increments generation, and
revokes public access. R2 deletion and physical D1 cleanup are retried
asynchronously and idempotently. A retry against the retained owner tombstone is
`204`; unknown/cross-owner is generic `404`. No storage failure may roll the row
back to active.

## Send Access Token Contract

### `POST /identity/connect/token`

Content type is `application/x-www-form-urlencoded`.

Base request:

```text
grant_type=send_access
client_id=send
scope=api.send.access
send_id={base64url-access-id}
```

Password auth additionally supplies `password_hash_b64={client-derived-hash}`.
The client derives that value with PBKDF2-SHA256, 100,000 iterations, using the
URL key material. The server receives no plaintext password and stores no raw
client hash.

The identity endpoint MUST:

1. syntactically validate and bound all form values;
2. consume the persistent IP bucket and capability bucket before lookup;
3. derive the capability keyed verifier under its current/read keyring;
4. load only the minimum authentication/state projection;
5. evaluate active/time/count/quarantine/kill-switch state;
6. evaluate the optional credential with constant-time keyed comparison;
7. return a short-lived signed token or a compatible bounded error.

The token contains issuer, Send-only audience, `scope=api.send.access`, internal
send id, `access_generation`, authentication method, issued/expiry times, token
key id, and random token id. Default expiry is five minutes, maximum accepted
clock skew is thirty seconds, and there is no refresh token or offline access.
It is invalid if current D1 state, generation, kill switch, audience, scope,
signature, or time does not match.

Success is the existing OAuth-style token envelope with bearer type and expiry.
It MUST set no-store headers.

### Token error contract

Errors are HTTP `400` OAuth-style responses with `error`, `error_description`,
and `send_access_error_type`. Compatible classes include:

| Condition class                    | `error`           | `send_access_error_type`                       |
| ---------------------------------- | ----------------- | ---------------------------------------------- |
| missing `send_id` field            | `invalid_request` | `send_id_required`                             |
| inaccessible/decoy identifier      | `invalid_grant`   | `send_id_invalid` or deterministic decoy class |
| password needed/missing            | `invalid_request` | `password_hash_b64_required`                   |
| password does not match            | `invalid_grant`   | `password_hash_b64_invalid`                    |
| email auth selected before support | `invalid_request` | `email_auth_unsupported`                       |

For an unknown syntactically valid identifier, a keyed deterministic decoy
chooses a stable invalid-id or password-required/invalid sequence. Processing
uses bounded response-size and timing classes. It never sends mail, creates an
OTP, or confirms whether the row existed. Email OTP wire fields `email` and
`otp`, plus expected values such as `email_required` and
`email_and_otp_required`, are reserved but not activated by HON-184/185.

Quota exhaustion is `429` with `Retry-After` and a generic body. Missing D1,
quota store, or token key is `503`, reported to observability before failure.

## Public Metadata Contract

The public response contains the ciphertext needed by the recipient plus bounded
compatibility metadata:

```json
{
  "Id": "public-access-id",
  "Type": 0,
  "AuthType": 1,
  "Name": "opaque-encrypted-string",
  "Text": { "Text": "opaque-encrypted-string", "Hidden": false },
  "File": null,
  "ExpirationDate": "2026-07-20T00:00:00.000Z",
  "CreatorIdentifier": "owner@example.invalid",
  "Object": "send-access"
}
```

`AuthType` is the recipient-facing authentication method already satisfied by
the access flow; it is not credential material. The response omits owner ID,
encrypted owner `Key`, notes, raw capability, password/email credential data,
counts, deletion date, D1/R2 keys, and audit state. When `HideEmail` is false,
`CreatorIdentifier` contains the owner's normalized email as the owner's
intentional recipient-facing disclosure. When `HideEmail` is true,
`CreatorIdentifier` is null. This field is no-store, never copied to logs or
audit, and is unrelated to deferred recipient email OTP. The client already has
the URL key needed for decryption.

### Legacy `POST /api/sends/access/:accessId`

Accepts body `{ "Password": "client-derived-hash-or-null" }` and compatible
`Send-Id: {accessId}`. The route exists for pinned legacy compatibility. It runs
the same capability, state, credential, quota, count, redaction, and cache policy
as V2; it is not a weaker bypass around `send_access`.

For text, text access is counted with metadata delivery using one conditional
UPDATE. For file, metadata preview does not increment. Success is `200` with
no-store. Every inaccessible state is generic `404`; quota is `429`; control-
plane failure is `503`.

### V2 `POST /api/sends/access`

Requires `Authorization: Bearer {send-access-token}` and no request body. Policy
validates Send-only audience/scope, send id, `access_generation`, state, and kill
switch.
Text access uses the same atomic count-and-project operation as legacy access.
The response shape and cache policy are identical.

The logical text authorization is one conditional UPDATE, not read-then-write:

```sql
UPDATE sends
SET access_count = access_count + 1,
    last_accessed_at = ?
WHERE id = ?
  AND access_generation = ?
  AND lifecycle_state = 'active'
  AND disabled = 0
  AND quarantined_at IS NULL
  AND deletion_at > ?
  AND (expiration_at IS NULL OR expiration_at > ?)
  AND (max_access_count IS NULL OR access_count < max_access_count)
RETURNING encrypted_name, encrypted_text, expiration_at, access_count;
```

Only a returned row is projected. The exact predicate
`access_count < max_access_count` prevents concurrent overrun.

## Public File Authorization Contract

### Legacy `POST /api/sends/:accessId/access/file/:fileId`

Accepts compatible `Send-Id` and password request fields. It shares every V2
authorization predicate and quota. It cannot access a pending, wrong-generation,
disabled, expired, exhausted, quarantined, or deleted file.

### V2 `POST /api/sends/access/file/:fileId`

Requires `Authorization: Bearer {send-access-token}`. The token's internal Send
must own `fileId` in the same active `access_generation`, and the file must carry
the current `object_generation`. File access is counted when a download URL is
issued, not when metadata is previewed.

The safe sequence is:

1. validate token, current Send state/generation, file state, quota, and private
   R2 object presence;
2. atomically increment with a conditional UPDATE using
   `access_count < max_access_count`;
3. generate a 32-byte CSPRNG random ticket ID and create a short-lived
   `send_download_tickets` budget row keyed by its verifier, containing the exact
   Send/file/access and object generations;
4. return `{ "Id": "file-id", "Url": "short-lived-url" }` with no-store.

The opaque download URL points to HonoWarden, not R2, and contains only the
random ticket ID. It has a maximum 60-second lifetime, no list/write permission,
and no ability to address another object. `Content-Disposition: attachment` uses
a safe constant fallback because the true filename is encrypted. Range/retry
behavior MUST NOT mint a new URL without a new authorization/count decision.

If URL creation fails after the conditional UPDATE, the consumed count remains.
The request returns `503`, emits a redacted failure event and metric, and does
not decrement because a compensating write could race with another request.

### `GET /api/sends/access/file-content/:ticket`

This HonoWarden extension is the URL returned above. `:ticket` is only the
base64url 32-byte random ticket ID. The URL contains no Send/file ID, generation,
capability, URL fragment key, filename, object key, or credential. The Worker
validates shape, derives a purpose-separated keyed verifier, and conditionally
loads/consumes the matching D1 row.

Application-controlled request, audit, metric, and error logging redacts the
ticket before serialization. That cannot redact a URL before the edge sees it;
platform request logs may observe the bearer path. Activation therefore requires
a logging policy that disables ticket-route request-log exports or demonstrably
excludes path, query, referrer, and authorization fields, plus restricted,
audited instant-tail/operator access and bounded retention.

Before opening the private R2 stream, the route verifies ticket expiry and
rechecks the out-of-band runtime gate, D1 kill switch, active state,
disabled/quarantine/time bounds, both generations, exact file relation, and
active object. It does not increment access count again because issuance already
consumed the count. It atomically consumes the matching `send_download_tickets`
request/byte budget before opening R2. The row permits a small bounded
range/retry allowance within 60 seconds, not unlimited replay; exhausted,
expired, or mismatched rows fail generically. R2 is never presigned; the Worker
streams the encrypted object through its private R2 binding with no-store,
restrictive CORS/referrer policy, byte-range validation, and
`Content-Disposition: attachment`.

Disable, delete, quarantine, generation change, or either kill gate invalidates
even an already-issued ticket before a new response starts. Bytes already
delivered on an in-flight response cannot be recalled. Unknown/invalid/stale
tickets are generic `404`; infrastructure failure is `503` and fails closed.

## Lifecycle State Machine

```text
file create -> pending_upload -> active -> disabled -> active
                         |          |          |
                         |          +------> expired
                         |          +------> quarantined
                         +-----------------> deleted
active/disabled/expired/quarantined -------> deleted
```

- Text create enters `active` atomically.
- File create enters `pending_upload`; only current-generation validated upload
  can compare-and-set to `active`.
- `disabled` is an owner-controlled reversible access state before deletion.
- `expired` is computed from time and is not made active by stale writes.
- An explicit owner-scoped date update may move `expired` to `active` before
  deletion only after validation and an `access_generation` increment; a stale
  or anonymous write cannot do so.
- `quarantined` is operator/automated abuse containment and requires audited
  release; owner update cannot clear it.
- `deleted` revokes access immediately and is logically terminal.
- Deletion date supersedes every other state.

Every security-relevant owner mutation increments `access_generation`. The
separate `object_generation` changes only when an immutable file allocation is
created/replaced by an explicitly supported future flow. A stale upload, token,
cleanup lease, or download-ticket request cannot target a replacement
generation. Cleanup uses compare-and-set leases and is idempotent.

## D1 Contract

The exact migration belongs to HON-184/185, but it MUST represent these logical
records without storing raw capabilities or credential inputs:

### `sends`

- internal `id`, `owner_user_id`, `type`, `auth_type`, `lifecycle_state`;
- encrypted capability envelope, unique `capability_verifier`, their key
  versions, and `access_generation`;
- encrypted name, notes, owner-encrypted Send key, encrypted text/hidden flag;
- password keyed verifier and key version, never raw client hash;
- max/access count, disabled/quarantine state and reason code;
- creation/revision/expiration/deletion/last-access timestamps;
- cleanup/tombstone metadata and bounded revision.

Indexes cover owner list, capability verifier lookup, pending expiry, deletion
cleanup, and quarantine operations. Every owner mutation includes
`owner_user_id`; every public mutation includes current generation/state/time.

### `send_files`

- Send/owner/file IDs, `object_generation`, and immutable generation-specific
  private object key;
- expected encrypted byte size, observed size, object identity/etag;
- `pending_upload` or `active`, upload deadline, validation timestamp;
- cleanup lease, attempt count, last failure class, deletion timestamp.

### `send_abuse_reports` and quota state

Reports store a pseudonymous capability reference, fixed reason enum, rotating
IP pseudonym, timestamps, disposition, and operator event ID. They omit free-form
payload, raw capability, owner/payload fields, and recipient identity. Request
quota buckets reuse or extend the persisted global quota design with IP bucket,
capability bucket, and account bucket dimensions and bounded expiry.

### `send_download_tickets`

Rows store only a keyed ticket-ID verifier, Send/file IDs, both generations,
expiry, maximum request count, remaining byte budget, and consumed counters. URL
ticket material is never stored. Ticket issuance follows the successful access-
count UPDATE; if row creation fails, no URL is returned and the count remains
consumed. Ticket GET uses a conditional UPDATE before streaming so parallel
replay cannot exceed the bounded range/retry budget. Rows expire and are cleaned
within five minutes.

### Feature and cleanup state

A versioned migration marker proves schema readiness. A feature record carries
enabled/kill-switch state and audited operator revision. A cleanup heartbeat
records last successful bounded pass and backlog counts. These records are
required for runtime activation, not optional diagnostics. They are insufficient
alone because D1 restore can rewind all three together.

The Worker configuration adds default-off
`HONOWARDEN_SEND_RUNTIME_ENABLED` and an environment-specific out-of-band
activation epoch. The D1 feature row stores a matching post-cleanup epoch. A
mismatch, missing value, or false runtime gate keeps config disabled and every
public Send route fail closed.

## R2 Contract

- The bucket is private and distinct by prefix from cipher attachments.
- Object names are generated by the server and include an unguessable internal
  Send component plus file ID and generation; clients never submit object keys.
- Bodies are opaque encrypted bytes. R2 metadata includes only bounded internal
  IDs, expected size, generation, and upload attempt ID.
- `pending_upload` cannot be read publicly.
- R2 is never presigned, publicly addressable, or accessed with client-supplied
  object credentials; the Worker ticket route streams through the binding.
- Activation verifies exact object/generation and observed size.
- Delete and orphan cleanup operate only on a D1-recorded generation-specific
  key and are idempotent. Prefix-wide delete is forbidden.
- A cleanup lease must be compare-and-set so overlapping Cron invocations cannot
  delete another generation or endlessly duplicate work.
- R2/list/delete failure is loud: record failure class, increment metrics, keep
  access revoked, retry with bounds, and alert before the 24-hour objective.

## Rate Limits And Quotas

All public limits are persisted in D1 or another explicitly consistent shared
store. Worker-isolate memory is not authoritative.

- token and metadata requests consume an IP bucket plus capability bucket;
- password failures consume stricter attempt buckets and a temporary capability
  lockout independent of generic metadata traffic;
- owner create/update/upload consumes an account bucket and active-count/byte
  quota;
- file authorization consumes capability/IP request and byte-budget buckets;
- file ticket streaming consumes ticket/IP request and byte budgets on every
  full or range response;
- abuse reports consume IP/capability report buckets;
- all `429` responses include `Retry-After` and no existence detail.

Exact secure defaults are versioned configuration in HON-184/186 and tested at
their boundary. Operators may lower limits. Raising hard ceilings requires a
review of D1 load, Worker CPU, R2 egress/cost, abuse alerts, and account fairness.
No unbounded or fail-open value is accepted.

## Error And Cache Matrix

| Surface                       | Client error                         | Infrastructure/control failure   | Cache               |
| ----------------------------- | ------------------------------------ | -------------------------------- | ------------------- |
| owner validation              | `400` typed                          | `503` after error report         | `no-store`          |
| owner unknown/cross-owner     | generic `404`                        | `503`                            | `no-store`          |
| token malformed/credential    | compatible OAuth `400`               | `503`                            | `no-store, private` |
| public inaccessible/exhausted | generic `404`                        | `503`                            | `no-store, private` |
| download ticket invalid/stale | generic `404`                        | `503`                            | `no-store, private` |
| shared quota exhausted        | `429` + `Retry-After`                | `503` if quota state unavailable | `no-store, private` |
| stale upload state            | `409` or `410` without object detail | `503`                            | `no-store`          |
| oversized body                | `413` before storage when possible   | `503` if quota cannot be proven  | `no-store`          |
| config/readiness signal       | `501` before source activation       | `503` after source activation    | `no-store`          |

Unexpected D1, R2, signing, quota, audit, or cleanup infrastructure failures are
reported to the configured observability system before failing. They are not
silently converted into empty lists, `404`, successful stubs, or in-memory
fallbacks.

## Audit Redaction Contract

Audit is allowlist-based. Allowed fields are event type, request ID, owner user
ID for owner events, pseudonymous Send/IP/account references, auth method, result
class, generation, size bucket, quota class, and timestamps.

Audit redaction MUST remove raw access capability, URL fragment key, account or
Send bearer token, password/client hash, email OTP, recipient address, opaque
download URL, R2 object key, encrypted metadata/payload, filename/body, raw IP,
and request/response bodies before console or D1 serialization.

This guarantee applies to Worker-controlled application logs and audit. Platform
request logs are a separate activation control because they can observe the URL
before application redaction.

Required event classes include owner create/update/disable/enable/password-
remove/delete, file pending/activated/failed/orphan-cleaned, public access
success/failure class, quota reject, quarantine/release, cleanup failure,
kill-switch change, feature activation/deactivation, and secret-key version
change. High-volume events use aggregation/sampling only after security counts
remain exact enough for alerts.

## Retention And Cleanup Contract

- required deletion is no more than 31 days ahead at each accepted create/update;
- optional expiration is no later than deletion;
- abandoned pending uploads are revoked and cleaned within 24 hours;
- deletion/expiry makes live D1/R2 data inaccessible immediately; encrypted
  payload/object cleanup completes within 24 hours under normal operation;
- a payload-free minimal tombstone persists for seven days for idempotent owner
  retry and cleanup reconciliation;
- abuse reports retain 90 days; audit metadata follows the existing 365-day
  policy; quota rows retain only their bounded enforcement window;
- download ticket rows expire and are removed within five minutes;
- encrypted payload may remain in the existing 35-day backup residual;
- restore prefers a fresh target with the runtime gate false; an unavoidable
  in-place restore requires false-gate readback and activation-epoch rotation
  before restore, then expiry/deletion/orphan cleanup before a new marker;
- legal hold is unsupported and cannot silently extend public access or
  retention.

Cleanup is bounded by rows/objects and execution time, records a cleanup
heartbeat, resumes from a stable cursor, and exposes backlog age/count metrics.
A stale heartbeat, oldest tombstone over 24 hours, or repeated object failure is
an alert and blocks activation.

## Feature Activation Contract

`send-enabled` can become true only if the exact environment has:

1. reviewed source and passing repository gates;
2. required migrations plus matching migration marker;
3. private R2 binding and independently versioned capability-envelope,
   lookup/password-verifier, and token secrets;
4. persistent quotas, audit persistence, and abuse state;
5. fresh cleanup heartbeat with no breach-level backlog;
6. `HONOWARDEN_SEND_RUNTIME_ENABLED=true` and a matching out-of-band activation
   epoch/post-cleanup D1 marker;
7. enabled D1 feature record and clear D1 kill switch;
8. cache-header/gateway-cache and platform request-log policy readback;
9. exact synthetic API/CLI/browser lifecycle and rollback evidence for the
   deployed commit.

Any missing item keeps `send-enabled: false`. After source implementation has
replaced the ADR 0009 route guard, a partially configured Send route returns
`503`; it never proceeds with missing quotas, audit, R2, secret, or cleanup.
Before that replacement, `501` remains the correct response.

No environment activation implies another. Local, staging, and production
evidence and feature records remain separate. Production activation, migration,
bindings, secret writes, DNS, and deploys require their applicable approval.

A Send-enabled target MUST NOT be restored in place while traffic is enabled.
Prefer restore into a fresh target with the runtime gate false. If in-place
restore is unavoidable, set and read back the out-of-band gate false, rotate its
activation epoch, perform the restore, run cleanup and synthetic checks, write a
new matching D1 marker, and only then re-enable. A restored enabled feature row,
clear kill switch, or fresh-looking historical heartbeat never bypasses the
epoch match. Control-plane restore events are monitored and audited.

## Kill Switch And Rollback

The out-of-band runtime gate and D1-backed kill switch are both checked by
config, token issuance, legacy access, V2 metadata, file authorization, and file
ticket streaming. Either false/active gate independently blocks new public
authorization and causes config to report disabled without deleting rows or R2
objects. Owner delete/disable and cleanup remain available so containment does
not prevent data removal.

Rollback sequence:

1. set `HONOWARDEN_SEND_RUNTIME_ENABLED=false` and the D1 kill switch, then read
   both paths back;
2. prove token, metadata, new ticket issuance, and already-issued ticket access
   fail closed;
3. record that bytes already sent on an in-flight response cannot be recalled;
4. preserve redacted audit/metric identifiers and drain cleanup;
5. revert/forward-fix code while additive schema remains compatible;
6. rerun migration, cleanup, quota, synthetic lifecycle, and rollback evidence;
7. rotate the activation epoch when restore or control-state compromise is in
   scope, and clear both gates only through the activation contract.

Rollback MUST NOT delete or alter cipher attachment rows/objects. A Send failure
cannot fall back to cipher attachment routes or public R2 access.

## Required Test Matrix

Later slices cannot claim source-ready without tests for:

- owner CRUD/list/get and cross-owner denial;
- no-auth/password token requests, deterministic decoy, malformed form, expiry,
  stale generation, audience/scope misuse, and no refresh token;
- text access final-count concurrency with exactly one successful conditional
  UPDATE;
- file metadata without count, file URL issuance with count, retry, short URL
  expiry, bounded range/retry budget, and `Content-Disposition`;
- pending upload, wrong size, stale completion, D1-after-R2 failure, orphan
  cleanup, delete failure/retry, and replacement-generation safety;
- disabled/expired/exhausted/quarantined/deleted generic public responses;
- IP/capability/account buckets, password lockout, `Retry-After`, and fail-closed
  quota-store errors;
- audit redaction and absence of capabilities, keys, tokens, credential hashes,
  download URLs, ciphertext, filenames, emails, and raw IP;
- `/api/config`, `/config`, Send guard/readiness, public-error, and ticket cache
  headers plus disabled gateway caching;
- ticket-route platform request-log export/field/access-policy readback;
- cleanup heartbeat/alert, old-enabled-snapshot epoch mismatch, fresh-target or
  disabled in-place restore cleanup, both kill gates, feature readiness `503`,
  and rollback isolation from cipher attachments;
- pinned official CLI text and file owner/receive/delete flows using synthetic
  ciphertext and exact deployed-commit evidence.
