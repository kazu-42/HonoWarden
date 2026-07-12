# ADR 0008: Login With Device Contract

## Status

Implemented behind environment flags. Enabled and live-tested with synthetic
data in staging; disabled in production.

## Context

Login with device lets an unauthenticated requester obtain an opaque encrypted
user key after an already authenticated device approves the request. The server
coordinates identity, expiry, approval, and one-time consumption, but must
never receive the requester private key or decrypt the user key.

The tracked official clients use a 15-minute request lifetime and the following
protocol shape:

- anonymous request creation with email, device identifier, requester public
  key, request type, and a high-entropy access code;
- authenticated listing and lookup for an approving device;
- authenticated approval or denial carrying the approver-produced encrypted
  key and approving device identifier;
- anonymous response polling using request id plus access code;
- an approval notification as a hint, followed by server readback;
- token exchange using the request id and access code after approval.

The original `/api/auth-requests` guard returned 501 until the persistence,
replay, audit, fixture, notification, and official-client gates below passed.
Unsupported methods and disabled environments still fail explicitly.

## Decision

Implement only personal-vault request types `AuthenticateAndUnlock` (`0`) and
`Unlock` (`1`). Organization or administrator approval (`2`) remains
unsupported because HonoWarden has no organization role model.

### HTTP Contract

| Method | Route                                         | Authentication | Purpose                                                                            |
| ------ | --------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| POST   | `/api/auth-requests` or `/api/auth-requests/` | anonymous      | Create one pending request after email, device, quota, and payload validation.     |
| GET    | `/api/auth-requests/pending`                  | bearer         | List unexpired pending requests owned by the authenticated user.                   |
| GET    | `/api/auth-requests/:id`                      | bearer         | Read an owner-scoped request for approval UI.                                      |
| PUT    | `/api/auth-requests/:id`                      | bearer         | Approve or deny once from a different active device.                               |
| GET    | `/api/auth-requests/:id/response?code=...`    | anonymous      | Poll status after constant-time access-code hash verification.                     |
| POST   | `/identity/connect/token` auth-request grant  | anonymous      | Atomically consume one approved request and issue the normal device-bound session. |

### Notification Contract

- Authenticated approver clients connect to `/notifications/hub` and receive
  pending request type `15` through the SignalR `ReceiveMessage` target.
- Requester clients connect to
  `/notifications/anonymous-hub?Token=<request-id>`. The Worker verifies that
  the bearer request id resolves to an existing, unexpired, owned request before
  proxying the WebSocket to a request-scoped Durable Object.
- Approval or denial sends response type `16` through the official
  `AuthRequestResponseRecieved` target. The payload contains only request id,
  owner user id, and the allowlisted notification type.
- The requester then reads the authoritative response endpoint with its access
  code. Encrypted key material is never carried in SignalR messages.

Request and response casing must remain compatible with the repository's
existing response-property mapping. API responses include stable request id,
requester public key, request device metadata, creation/response timestamps,
approval state, encrypted key only after approval, and request device id where
the official client expects it. They never return access-code hashes, audit
metadata, requester private keys, or approver private material.

### State Machine

```text
pending
  -> approved -> consumed
  -> denied
  -> expired

approved
  -> expired (when not consumed before the fixed deadline)
```

Transitions are compare-and-set operations. Approval, denial, and consumption
are single-use. Repeated identical transitions return the current public state;
conflicting transitions fail with 409. Expiration is based on the immutable
creation deadline and cannot be extended by polling, resending notifications,
or retries.

### Cryptographic And Authorization Invariants

- Generate the requester key pair and access code only in the client.
- Store the requester public key and a keyed hash of the access code; never
  store the access code or requester private key.
- Treat the encrypted response key as opaque ciphertext. The Worker cannot
  decrypt, validate, transform, or log it.
- Resolve the request owner from normalized email without disclosing whether an
  account exists. Unknown-account creation follows the same public response
  timing and shape but cannot become approvable.
- Require a valid owner-scoped access token and active approving device for
  pending/read/approve routes.
- Reject approval from the requester device identifier. Record both device ids
  only as owner-scoped identifiers and omit them from platform logs.
- Bind token exchange to request id, access-code hash, approved state,
  requester device identifier, owner, expiry, and unconsumed state in one D1
  transaction or equivalent atomic statement.
- Do not accept an encrypted user key in a denial response.
- Do not trust notification payloads for state or key delivery; clients must
  read the response from the authenticated/polling API.

### Abuse, Audit, And Retention

- Apply bounded per-account-hash, requester-device, and client-network quotas
  to anonymous creation and response polling.
- Use generic not-found/invalid responses for unknown owner, request id, code,
  expired request, and already-consumed request where enumeration risk exists.
- Audit create, approve, deny, consume, expire, quota rejection, and replay
  outcomes without email, IP, access code, public key, encrypted key, or token.
- Retain terminal rows only for a bounded incident window, then delete them via
  scheduled cleanup. Initial implementation uses a 15-minute active lifetime
  and at most 30 days of metadata-only terminal retention.
- Notification delivery contains request id and event type only. Failure is
  observable but does not change authoritative request state; polling remains
  the fallback.

### Migration And Rollback

- Add a forward-only D1 table and indexes before enabling routes.
- Deploy routes behind an environment flag defaulting off, then verify fixture
  and synthetic lifecycle evidence in staging.
- Rollback disables the flag and restores the explicit 501 guard. The table may
  remain until terminal retention cleanup; rollback must never re-open consumed
  requests.
- Compatibility promotion requires official-client create, approve, poll,
  token consume, denial, expiration, and replay evidence with synthetic data.

## Rejected Alternatives

- **Store the access code encrypted for later comparison:** rejected because a
  verifier needs only a keyed hash and recoverability increases breach impact.
- **Deliver the encrypted user key in push notifications:** rejected because
  notification transport is a hint channel, not an authoritative or replay-safe
  data channel.
- **Allow the requester device to approve itself:** rejected because it removes
  the second-device authorization property.
- **Reuse approved requests:** rejected because server-enforced single use is
  required even if a client clears its local cache.
- **Implement administrator approval now:** rejected until organization roles,
  membership, and authorization exist.

## Consequences

- HON-79 implemented persistence and polling/approval/token APIs against this
  contract.
- HON-80 implemented owner and requester Durable Object notification delivery.
- HON-95 captured the official Desktop/browser synthetic lifecycle, including
  fingerprint comparison, approval, one-time token exchange, and empty-vault
  rendering.
- Production remains disabled until a separate, explicitly approved rollout
  satisfies the real-secret readiness gates.
