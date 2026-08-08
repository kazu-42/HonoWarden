# ADR 0011: Send And Public-Sharing Product Line

## Status

Accepted as a design and delivery contract. Runtime activation remains disabled.

This decision supersedes ADR 0003's permanent alpha exclusion for a new Send
product line. It does not supersede the current `501 unsupported_feature` guard
or create a runtime support claim. ADR 0009 continues to govern the live route
boundary until every activation gate in this ADR has passed.

## Context

Send is not an authenticated cipher attachment with a public route added to it.
It is a separate product surface with an owner control plane and an anonymous
data plane. Anyone who obtains a link can drive request volume, credential
attempts, metadata reads, and large file transfers. Expiration, disable, maximum
access count, owner deletion, object cleanup, abuse response, and backup
retention must remain coherent across D1, R2, Worker caches, and short-lived
authorization artifacts.

The pinned official clients expect encrypted text and file Send lifecycle
routes, a `send_access` token grant, legacy anonymous routes, and bearer-token
V2 routes. The client constructs links whose access identifier and cryptographic
key are in the URL fragment. Client code extracts both values, sends only the
access identifier to the API, and retains the key for local encryption and
decryption. Compatibility therefore depends on the wire shapes, but security
depends on preserving that cryptographic split and on adding Cloudflare-native
failure semantics that the route list alone does not provide.

ADR 0003 required a replacement decision to cover token entropy, expiration,
revocation, maximum access count, rate limits, abuse handling, cache policy,
D1/R2 lifecycle, retention, redaction, audit, and compatibility evidence. This
ADR accepts the product line only with those controls and a sliced rollout.

## Decision

Adopt Send as a separate, default-off product line implemented in four slices.

1. HON-183 defines and reviews this ADR, the dedicated threat model, and the
   wire/storage contract. It changes no runtime route.
2. HON-184 implements the encrypted text owner lifecycle and its stateful domain
   behavior behind a disabled activation boundary. It must not advertise or
   expose anonymous support merely because source capability exists.
3. HON-185 implements encrypted file metadata, R2 transfer, generation-bound
   activation, download authorization, and cleanup behind the same boundary.
4. HON-186 integrates public token access, password attempts, persistent quotas,
   abuse operations, monitoring, cleanup evidence, kill-switch behavior, and
   pinned official-client lifecycle evidence. Only this slice may promote an
   evidenced Send flow to runtime support.

HON-184 and HON-185 may be developed independently after HON-183. HON-186 is
blocked by both. The parent program remains open until every required child is
closed bottom-up.

### No partial exposure

No partial exposure is allowed. Before HON-186 activation, all `/api/sends`,
`/api/sends/*`, and `grant_type=send_access` requests continue to return the
ADR 0009 `501` response after any enabled global ingress quota check, but before
route-specific authentication, Send-specific D1, R2, token, or audit work.
`/api/config` continues to advertise `send-enabled: false`.

Three claims remain separate:

- **source capability** means code and local tests exist;
- **runtime activation** means migrations, bindings, secrets, cleanup, quotas,
  audit, kill switch, and the activation record are healthy in one environment;
- **live compatibility evidence** means a pinned official client completed the
  claimed synthetic lifecycle against that exact deployed commit.

Documentation and config may promote only the narrowest claim supported by
evidence. A source-ready branch cannot imply runtime or production support.

### Zero-knowledge boundary

The client owns the Send symmetric key. The public link format retains the
access identifier and key in a URL fragment such as
`/#/send/{accessId}/{urlB64Key}`. A URL fragment is not sent in the initial HTTP
request; the client application parses it and sends only `accessId` as the send
id needed by the API. The Worker never receives plaintext Send names, notes,
text, filenames, file bodies, or the raw URL-fragment decryption key. D1 and R2
store opaque ciphertext only.

Owner-supplied encrypted fields are untrusted opaque strings. The server
validates type, encoded length, dates, ownership, quotas, and state transitions,
but does not decrypt or infer content. Logs, metrics, audit events, abuse reports,
and error responses must not include encrypted payloads because ciphertext and
length metadata can still be sensitive.

The account email is not Send payload plaintext. For pinned-client
compatibility, a public response includes it as `CreatorIdentifier` only when the
owner submits `HideEmail=false`; `HideEmail=true` returns null. This is an
intentional owner-controlled disclosure, remains no-store, and is never copied
to public audit/metrics.

### Public capability and verifier storage

Each Send receives an independent 16-byte value from a CSPRNG. All 128 bits are
encoded as the base64url access identifier. It is a bearer capability, not a
human identifier. Official owner list/get responses must be able to return it,
so D1 stores two non-plaintext forms: an encrypted capability envelope for
owner-only recovery and a keyed verifier for indexed public lookup. The raw value
is returned only through authenticated owner responses and is never stored in
plaintext or emitted to logs.

The two forms have independent versioned roots.
`HONOWARDEN_SEND_CAPABILITY_ENVELOPE_SECRET` derives only the AEAD envelope
keyring. `HONOWARDEN_SEND_LOOKUP_VERIFIER_SECRET` derives the HMAC lookup keyring
and purpose-separated credential, decoy, audit, and quota keys. Capability
lookup recomputes the keyed verifier and uses a unique indexed column; it never
decrypts every row. Comparisons of credential verifiers and fallback candidates
are constant-time. Separate derivation labels prevent audit/quota identifiers
from being joined to the lookup verifier. Each root supports one active write key
and bounded previous read keys. Owner-authenticated reads may lazily rewrap an
envelope; the two keyrings rotate independently.

D1 plus the active capability-envelope root can recover every encrypted raw
`AccessId` under that key. This accepted blast radius is narrower than sharing
one root with lookup, but it is still a link-exposure incident. Containment sets
the out-of-band runtime gate false, sets the D1 kill switch, rotates both
keyrings, regenerates capabilities and lookup verifiers for every surviving
Send, increments access generations, and treats every old link as revoked.

The capability's entropy is the primary anti-enumeration control. Token errors
also use a keyed deterministic decoy class for unknown identifiers, response
padding/timing bounds, and persistent IP bucket plus capability bucket limits.
No response confirms whether an unknown identifier belongs to a no-auth,
password, disabled, expired, exhausted, quarantined, or deleted Send.

### Password and email authentication

The compatibility password input is the client-side
`password_hash_b64`: PBKDF2-SHA256 with 100,000 iterations over the user-entered
password using URL key material. The server never receives the plaintext
password. It stores only a versioned keyed verifier of the client hash, scoped to
the Send and computed under a password-specific derivation label. Online checks
are constant-time and subject to stricter IP, capability, and account buckets.

The server-side keyed verifier is intentional. Repeating an expensive,
attacker-controlled password KDF in a Worker would amplify anonymous CPU denial
of service. The client KDF plus a server-held key prevents useful offline checks
from a D1-only disclosure; persisted quotas bound online checks. A compromise of
both D1 and `HONOWARDEN_SEND_LOOKUP_VERIFIER_SECRET` still permits password
guessing when an attacker also has the URL key, and remains a documented
residual risk.

The pinned wire contract also includes email OTP authentication. Initial
stateful slices accept only no-auth and password auth. Email OTP is explicitly
deferred until a separate delivery, anti-spam, recipient-privacy, OTP replay,
mail-provider failure, and retention design is approved. Requests that select
email auth fail atomically with a typed unsupported-auth response; they do not
create a partially accessible Send.

### Send-scoped access token

`send_access` issues a short-lived bearer token only after capability and
credential evaluation. The token has a Send-only audience and scope, the
internal send id, current access generation, issued/expiry times, authentication
method, key id, and a random token id. It has no refresh token and cannot be used
as an account token. API policy requires the audience, `api.send.access` scope,
send id, and generation to match the current D1 row on every metadata or file
authorization request.

The default lifetime is five minutes, the accepted clock skew is at most thirty
seconds, and clients treat tokens with less than five seconds remaining as
expired. Disable, quarantine, owner delete, credential change, or security-
relevant update increments the generation, making previous tokens unusable even
inside their nominal lifetime.

The token is reusable for metadata followed by file authorization, so a bounded
bearer replay window remains. It must never be persisted by the server, logged,
placed in a URL, accepted after expiry/generation change, or exchanged for a
refresh token. This is an explicit residual risk rather than a false one-time
token claim.

### Lifecycle and D1/R2 consistency

Text Sends become `active` in one owner-scoped D1 transaction. File Sends start
as `pending_upload`; public lookup ignores every state except `active`. The
`access_generation` invalidates public tokens on security changes, while the
separate `object_generation` binds an immutable file upload and cleanup target.
File objects use generation-specific, server-generated R2 keys. Upload
completion verifies expected size and object metadata, then performs an
owner/file/`object_generation` compare-and-set from `pending_upload` to `active`.

The lifecycle contains `pending_upload`, `active`, `disabled`, `expired`,
`quarantined`, and `deleted`. Expiration is a computed access state; deletion is
a tombstone transition followed by bounded physical cleanup. No cleanup job may
delete an object unless the D1 tombstone and the exact generation-specific key
still match. Every cleanup operation is idempotent.

Before deletion, an authenticated owner may move `expired` to `active` by
submitting newly valid dates. That transition increments `access_generation` so
old access tokens remain invalid. Anonymous or stale writes cannot reactivate it;
`deleted` remains terminal.

D1 and R2 do not share a transaction. The safe ordering is:

1. create pending metadata;
2. write the generation-specific encrypted object;
3. verify object size and identity;
4. compare-and-set metadata active;
5. enqueue or discover any abandoned object through bounded orphan cleanup.

Delete, disable, quarantine, and expiry revoke public access in D1 first. R2
deletion follows and retries. A failed R2 deletion is an operational alert and
retention breach risk, not a reason to resurrect public access. A failed D1
activation leaves an inaccessible object for cleanup. Infrastructure failures
fail closed and are reported before the request returns `503`.

### Maximum access count

Access counting is enforced by one D1 conditional UPDATE with a returning row.
Its predicate includes active state, time bounds, generation, and
`access_count < max_access_count` when a maximum is present. A read followed by
an update is forbidden because parallel requests could exceed the limit.

For text, text access is counted with metadata delivery. The successful
conditional UPDATE and response projection are one logical operation. For
files, metadata preview does not consume a count; file access is counted when a
download URL is issued. The count is consumed before the opaque download URL is
returned. If ticket-row creation fails afterward, the count remains consumed and
the failure is audited; decrementing would introduce a race and quota bypass.

### Cache and download policy

Token, public metadata, error, and download-authorization responses set
`Cache-Control: no-store, private`, `Pragma: no-cache`, and a restrictive
referrer policy. `/api/config`, `/config`, every Send `501` guard, and every
future `503` readiness failure also set `Cache-Control: no-store` before HON-186
activation. The gateway cache remains disabled, and activation evidence proves
these responses are not served from a shared cache. File responses use
`Content-Disposition: attachment` with a sanitized fallback name; the real
encrypted filename remains client-decrypted.

R2 remains private and R2 is never presigned or made public. The opaque download
URL points to a HonoWarden Worker ticket route and contains only a 32-byte CSPRNG
random ticket ID. All Send/file/access and object generations, expiry, and retry
budgets live in a keyed-verifier D1 ticket row. The URL is a bearer secret with a
maximum sixty-second lifetime. Application console, audit, metrics, and error
events redact it before serialization.

Application redaction cannot run before the edge observes a request URL.
Platform request logs may therefore observe the ticket path. Before activation,
the ticket route is isolated under a logging policy that disables request-log
exports for it or demonstrably excludes path, query, referrer, and authorization
fields; instant-tail and operator access are restricted and audited. The design
does not claim that infrastructure outside the Worker never observes a bearer
URL. The short lifetime, random ID, D1 budget, and current-state checks limit that
residual but do not erase it.

The ticket route atomically consumes its D1 budget and rechecks current state,
generations, both kill gates, expiry, and exact object before streaming from the
R2 binding. Disable, delete, quarantine, generation change, or either kill gate
therefore invalidates an already-issued ticket immediately. Bytes already sent
on an in-flight response cannot be recalled and remain the bounded residual.

### Abuse controls and observability

Anonymous enforcement uses persistent D1 buckets, never isolate-local memory:

- an IP bucket keyed by a rotating HMAC of the normalized client address;
- a capability bucket keyed with a non-lookup derivation;
- an account bucket for owner mutations and aggregate storage quotas.

Credential failures have stricter windows than metadata reads. Rejected quota
responses use `429` and `Retry-After` without confirming Send existence. The
implementation records counts and bounded reason codes, not raw IP addresses,
capabilities, tokens, payloads, filenames, passwords, recipient addresses, or
download URLs.

HON-186 must provide an abuse-report path with a fixed reason enum and generic
`202` response, owner disable/delete controls, operator quarantine, independent
out-of-band and D1-backed kill gates, quota and cleanup metrics, and actionable
alert thresholds. Abuse reporting is rate-limited and cannot become a
Send-existence oracle.

### Retention and deletion

Deletion date is required, is after the current time, and is at most 31 days in
the future on every accepted create/update. Optional expiration must not exceed
deletion. `pending_upload` rows and objects expire after 24 hours. Active D1/R2
data becomes inaccessible at the deletion timestamp. Encrypted payload and R2
object cleanup completes within 24 hours; a payload-free minimal tombstone may
remain for seven days for owner idempotency and cleanup reconciliation.
Rate-limit rows and one-time operational records use shorter documented windows.
Audit records follow the existing 365-day metadata-only policy.

Disaster-recovery backups may retain encrypted deleted payloads for the existing
35-day backup residual. A Send-enabled database MUST NOT be restored in place
while traffic is enabled. Prefer import into a fresh target whose runtime gate is
false. If an in-place restore is unavoidable, first set
`HONOWARDEN_SEND_RUNTIME_ENABLED=false`, read back disabled config and rejected
token/ticket access, rotate the out-of-band activation epoch, and only then
restore. Deletion/expiry/orphan cleanup and full synthetic evidence run against
the restored target before a D1 activation marker may be written for the new
epoch. An old snapshot's enabled feature record or clear kill switch cannot match
that new epoch and therefore cannot make an expired link live.
Initial Send has no user-visible legal hold. A legal hold requires a separate
policy decision, operator authorization, immutable audit trail, and UI/API
disclosure; silently extending public availability or object retention is
forbidden.

### Activation and rollback

The source flag alone is insufficient. An environment can advertise Send only
when all of these are true:

- the build includes the reviewed source capability;
- required D1 migrations and a versioned migration marker exist;
- the private R2 binding and independently versioned capability-envelope,
  lookup/password-verifier, and token secrets are present;
- persistent request buckets and audit persistence are healthy;
- scheduled expiry, tombstone, and orphan cleanup has a fresh cleanup heartbeat;
- the default-off out-of-band `HONOWARDEN_SEND_RUNTIME_ENABLED` gate is true and
  its activation epoch matches the post-cleanup D1 activation marker;
- the D1 feature record is enabled and the kill switch is clear;
- cache and platform request-log policy evidence passes for config, readiness,
  public access, and ticket routes;
- synthetic text/file, disable, expiry, delete, quota, and rollback evidence is
  attached to the exact deployed commit.

Any missing or inconsistent prerequisite keeps config at
`send-enabled: false`. Direct Send requests return `503` for a partially
configured environment rather than bypassing a control. Before source
activation, ADR 0009's `501` remains authoritative.

Operational rollback sets `HONOWARDEN_SEND_RUNTIME_ENABLED=false` and the D1
kill switch, then reads both paths back. Either gate independently makes config
report disabled and token, metadata, and new download authorization fail closed
without deleting data. Already-issued Worker download tickets also fail their
current-state check; only bytes already sent on an in-flight response cannot be
recalled. Code can then be rolled back or forward-fixed while cleanup continues.
Additive migrations are preferred; destructive rollback is not required. Cipher
attachments use a different table, R2 prefix, authorization path, and feature
state and must not be affected.

## Consequences

- Send becomes an accepted future product line, but current compatibility and
  current-state documents remain unchanged until live evidence exists.
- The implementation needs dedicated D1 metadata, quota/report state, a private
  R2 prefix, versioned verifier/token secrets, scheduled cleanup, and incident
  controls.
- Public errors intentionally carry less diagnostic detail than owner and
  operator evidence. Correlation uses a request ID and redacted internal events.
- Maximum access is exact at authorization issuance, not proof that a recipient
  consumed or decrypted the payload.
- Worker-validated random-ID tickets avoid public/presigned R2 and support
  immediate revocation before a response starts, at the cost of D1 lookup,
  platform-log handling, and streaming bytes through the Worker path.
- Email OTP and legal hold are not silently approximated. They remain separate
  design gates.

## Rejected Alternatives

- Reusing cipher attachment rows or owner authorization: this would mix public
  and authenticated trust boundaries and make cleanup/backup semantics unsafe.
- Storing the raw access identifier for lookup: a D1 disclosure would expose
  immediately usable public links.
- Trusting entropy alone and omitting quotas: leaked links and password endpoints
  still permit denial of service and online guessing.
- Read-then-increment access count: parallel requests can exceed the maximum.
- Making R2 objects public: revocation, cache policy, audit, and kill-switch
  behavior cannot be enforced.
- Enabling text before shared public controls exist: this violates No partial
  exposure and creates an unmonitored anonymous data plane.
- Deleting R2 before recording a D1 tombstone: a storage failure can leave a live
  link or make retries target the wrong generation.
