# Emergency Access Threat Model

Last reviewed: 2026-09-02.

## Status And Scope

This model is the HON-188 pre-implementation security contract. It describes
the Emergency Access product line accepted by ADR 0013 and the controls
required before runtime activation. It is not evidence that Emergency Access is
implemented, deployed, or safe for real secrets.

Current behavior remains the ADR 0009 boundary: `/api/emergency-access` and
every child route return explicit `501 unsupported_feature` after any enabled
global ingress quota check, but before route-specific authentication or
Emergency Access storage. The pinned client's trusted-list preflight therefore
blocks account-key rotation, which is an explicit incompatibility rather than a
hidden empty-list success.

In scope for the future product line:

- grantor/grantee identity and invitation proofs;
- confirmation and opaque `KeyEncrypted` handoff;
- delayed initiate/approve/reject/timeout;
- view, attachment, takeover, and password closeout;
- notification attempts, audit, quotas, kill switch, rotation rewrap, and
  rollback.

Out of scope for HON-188:

- stateful HTTP routes, D1 schema, notification adapters, or scheduled jobs;
- organization account recovery, operator account disable/restore, or Key
  Connector;
- a claim that mail delivery proves the grantor saw a request.

## Security Objectives

1. The Worker never decrypts vault keys, cipher payloads, or attachment bodies.
2. The state machine has no path that skips identity proof, confirmation,
   wait/approval, or current key-generation checks.
3. Notification loss never grants access and notification success alone never
   advances authoritative state.
4. View-only cannot mutate or obtain takeover material; takeover cannot access a
   different key generation or a foreign attachment.
5. Grantor recovery, removal, disable, and the kill switch immediately
   invalidate future access while preserving required audit evidence.
6. Emergency Access is not a substitute for organization account recovery or
   operator account control.

## Assets

| Asset                                 | Location               | Required property                                                   |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| grantor user symmetric key            | grantor client         | wrapped to the grantee at confirm; never plaintext on the Worker    |
| grantee account private key           | grantee client         | never sent to HonoWarden                                            |
| opaque `KeyEncrypted`                 | D1 relationship row    | ciphertext only; bound to current key generation                    |
| invite token                          | mail + hashed D1 proof | single-use, expiring, id- and recipient-email-bound                 |
| wait deadline                         | D1 UTC timestamps      | server-authoritative; client clocks cannot shorten it               |
| personal cipher/attachment ciphertext | D1/R2                  | returned only after View + RecoveryApproved + generation checks     |
| grantor master-password wrap          | D1                     | replaced only after Takeover + RecoveryApproved + generation checks |
| notification attempt state            | D1                     | retryable; cannot write Status                                      |
| audit/metrics                         | D1/log platform        | redacted; no tokens, keys, or ciphertext                            |
| runtime gate                          | Worker configuration   | default-off, out-of-band from D1 restore                            |

## Actors

- a grantor with a valid account token;
- a designated grantee with a matching account;
- an invited email holder who does not yet control the matching account;
- an attacker with a stolen bearer token, a replayed invite token, or a guessed
  relationship id;
- a compromised mail provider or delayed notification channel;
- an operator with backup/restore and kill-switch access.

## Trust Boundaries

1. **Authenticated grantor/grantee to Worker:** bearer identity is necessary but
   not sufficient. Actor, status, type, and key generation are separate
   predicates.
2. **Invite token to accept:** untrusted until unprotect, expiry, single-use,
   id, and recipient email checks succeed.
3. **Client-supplied `KeyEncrypted` and password wraps:** untrusted opaque
   strings. The server validates length and ownership, never decrypts.
4. **Notification provider to Worker:** untrusted. Delivery receipts cannot
   write D1 status.
5. **Scheduled timeout job to D1:** trusted only through the same conditional
   UPDATE as grantor approve. A stale job cannot approve a replaced generation.
6. **Worker to logs/audit/evidence:** lower trust and longer lived. Only bounded
   codes and identifiers may cross it.

## Attacker Capabilities

- Send arbitrary authenticated requests, race approve/reject/timeout, and replay
  invite tokens.
- Control request JSON, relationship ids, wait-time fields, and opaque key
  blobs.
- Drop, delay, or forge mail-provider success for invite or recovery messages.
- Steal a grantee session after confirm but before or during recovery.
- Restore an old D1 snapshot that still contains a `RecoveryApproved` row.
- Use Emergency Access as a confused deputy against organization recovery or
  operator disable.

## High-Risk Abuse Paths

### Skip identity proof

Accept without a matching recipient email, or invite a grantor's own account.
Mitigation: token + email bind, self-invite rejection, generic failures.

### Skip confirmation

Initiate or view from Invited/Accepted. Mitigation: status predicate on every
mutating and data-returning route; `KeyEncrypted` absent until confirm.

### Skip wait/approval

Client-supplied remaining wait, re-initiate, or "grantor did not receive mail"
used as approval. Mitigation: server-authoritative timestamps, initiate quota,
notification never writes Status, timeout uses original `RecoveryInitiatedDate`.

### Skip current key-generation checks

Serve a pre-rotation `KeyEncrypted` after the grantor rotated keys, or rotate
without rewrapping confirmed contacts. Mitigation: generation column; rotation
fails closed while `emergencyAccessUnlockData` must be empty; later rewrap is
mandatory.

### Notification as authority

Treat mail success as confirm/approve, or mail loss as timeout. Mitigation:
Notification loss never grants access; notification success alone never
advances authoritative state; durable retry is separate from Status.

### View/takeover confusion

View type calling takeover/password, or takeover calling view/attachment for a
foreign cipher. Mitigation: type is part of every data-returning predicate.

### Attachment `404` fallback

Using `404` as the unsupported signal. Mitigation: ADR 0009 `501` until
activation; after activation, `404` means not found inside an enabled product.

### Restore resurrection

An old approved row or enabled feature flag returns from backup. Mitigation:
out-of-band runtime gate and activation epoch must match; restore prefers a
fresh target with the gate false.

### Invite/initiate flooding

Repeated invites or recovery starts as abuse or wait-shortening. Mitigation:
invite quota, initiate quota, and no wait reset on duplicate initiate.

## Failure Matrix

| Failure                       | Required outcome                                     |
| ----------------------------- | ---------------------------------------------------- |
| invalid/replayed invite token | no status change                                     |
| notification adapter down     | D1 status unchanged or already written; retry; alert |
| approve/reject/timeout race   | one conditional UPDATE winner                        |
| D1 unavailable                | `503` after error report; no in-memory grant         |
| stale key generation          | fail closed; no ciphertext returned                  |
| kill switch / runtime gate    | new initiate/view/takeover fail; audit retained      |
| partial HON-189/190 source    | routes remain `501`; no partial exposure             |

## Audit Redaction

Allowed: event type, request ID, actor role, relationship id, from/to status,
type, key generation, result class, timestamps.

Forbidden: invite token, `KeyEncrypted`, cipher/attachment ciphertext, download
URLs, raw email, master-password hashes, request/response bodies.

## Residual Risks

- A confirmed grantee who later becomes hostile still holds a wrap of the
  grantor's user key and can request access; wait time and grantor reject are
  the remaining controls.
- Wait timeout can approve while the grantor is unavailable. That is the
  product's explicit grantor-chosen risk, not notification loss granting access.
- Takeover replaces the grantor master-password wrap and clears two-step login;
  recovering from a malicious takeover requires operator account lifecycle, not
  this product line.
- Independent security review of this design is still required to close HON-188
  and is not satisfied by these documents existing.
