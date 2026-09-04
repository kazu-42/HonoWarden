# ADR 0013: Emergency Access And Delegated-Recovery Product Line

## Status

Accepted as a design and delivery contract. Runtime activation remains disabled.

This decision supersedes ADR 0004's permanent alpha exclusion for a new
Emergency Access product line. It does not supersede the current
`501 unsupported_feature` guard or create a runtime support claim. ADR 0009
continues to govern the live route boundary until every activation gate in this
ADR has passed.

## Context

Emergency Access is delegated recovery, not vault sync. A grantor invites a
grantee, the grantee proves control of a matching account, the grantor confirms
by wrapping the current user key to the grantee's public key, and only then may
the grantee start a wait. After grantor approval or a server-authoritative wait,
the grantee may view personal ciphers or take over the account. The Worker never
decrypts vault material. Notification is an out-of-band hint, not authority.

ADR 0004 required a replacement decision covering identity, invitation,
delay, approval, cancellation, timeout, notification, cryptographic handoff,
audit, abuse, rollback, incident response, and compatibility fixtures. The
pinned official clients already expose the full route family whenever account
premium state is true; HonoWarden currently returns `501` because a missing
route or empty trusted list would let key rotation or attachment fallback
continue unsafely.

The current user-key-rotation writer still requires
`emergencyAccessUnlockData` to be an empty array. That fail-closed check remains
correct until a later slice can rewrap every confirmed contact to the current
key generation.

## Decision

Adopt Emergency Access as a separate, default-off product line implemented in
four slices.

1. HON-188 defines and reviews this ADR, the dedicated threat model, and the
   wire/state contract. It changes no runtime route.
2. HON-189 implements grantor/grantee directory, invitation delivery, accept,
   confirm, update, reinvite, and remove with no vault access.
3. HON-190 implements initiate, wait deadline, approve, reject, cancel/expiry,
   scheduled transitions, and idempotent notifications.
4. HON-191 implements view, attachment, takeover, password closeout, audit,
   quotas, kill switch, rotation rewrap, and official-client evidence. Only this
   slice may promote an evidenced Emergency Access flow to runtime support.

HON-189 is blocked by HON-188. HON-190 is blocked by HON-189. HON-191 is blocked
by HON-190. The parent program HON-187 remains open until every required child
is closed bottom-up.

Emergency Access is not a substitute for organization account recovery or
operator account control.

### No partial exposure

No partial exposure is allowed. Before HON-191 activation, all
`/api/emergency-access` and `/api/emergency-access/*` requests continue to
return the ADR 0009 `501` response after any enabled global ingress quota check,
but before route-specific authentication, Emergency Access D1, notification,
token, or audit work. Returning an empty trusted list would let the pinned
client continue account-key rotation. Returning `404` for an attachment lookup
would activate cached-URL fallback.

Three claims remain separate:

- **source capability** means code and local tests exist;
- **runtime activation** means migrations, bindings, notification adapters,
  scheduled wait jobs, audit, kill switch, and the activation record are healthy
  in one environment;
- **live compatibility evidence** means a pinned official client completed the
  claimed synthetic lifecycle against that exact deployed commit.

Documentation and config may promote only the narrowest claim supported by
evidence. A source-ready branch cannot imply runtime or production support.

### Identity, confirmation, wait, and key generation

The state machine has no path that skips identity proof, confirmation,
wait/approval, or current key-generation checks.

- Invite binds a grantor, a recipient email, an access type, and a wait time.
- Accept requires an authenticated grantee whose email matches a single-use,
  expiring invite token bound to that relationship id.
- Confirm requires the grantor and stores opaque `KeyEncrypted` for the current
  grantor key generation. Invited or accepted contacts cannot initiate or view.
- Initiate is allowed only from `Confirmed` by the bound grantee.
- View, attachment, takeover, and password are allowed only from
  `RecoveryApproved`, only for the configured type, and only when `KeyEncrypted`
  matches the grantor's current key generation.
- Grantor reject or delete, grantee delete, account disable, and key rotation
  without a matching rewrap invalidate future access.

### Notification is not authority

Notification loss never grants access and notification success alone never
advances authoritative state. D1 conditional updates are the only status
writer. Mail, push, and in-app delivery may retry, but a lost invite cannot
become accepted, a lost recovery mail cannot become approved, and a successful
send cannot skip identity proof, confirmation, wait/approval, or current
key-generation checks. The wait timeout is a grantor-chosen D1 deadline, not a
substitute for proving the grantor received mail.

### Activation and rollback

An environment can advertise Emergency Access only when all of these are true:

- the build includes the reviewed source capability;
- required D1 migrations and a versioned migration marker exist;
- notification adapters, scheduled wait/reminder jobs, and a fresh job
  heartbeat exist;
- persistent invite/initiate quotas and audit persistence are healthy;
- the default-off out-of-band
  `HONOWARDEN_EMERGENCY_ACCESS_RUNTIME_ENABLED` gate is true and matches the
  post-cleanup D1 activation marker;
- the D1 feature record is enabled and the kill switch is clear;
- synthetic invite-through-view-or-takeover, reject, delete, rotation, disable,
  and rollback evidence is attached to the exact deployed commit.

Any missing prerequisite keeps routes at `501` before source replacement and
`503` after source replacement of the ADR 0009 guard. Operational rollback sets
the runtime gate false and the D1 kill switch, then reads both paths back.

## Consequences

- Emergency Access becomes an accepted future product line, but current
  compatibility and current-state documents remain unchanged as support claims
  until live evidence exists.
- Later slices need dedicated D1 relationship state, opaque key material,
  generation counters, notification attempt rows, quotas, scheduled jobs, and
  incident controls.
- Account-key rotation continues to reject non-empty
  `emergencyAccessUnlockData` until HON-191 can rewrap every confirmed contact.
- Independent security review of this design remains a HON-188 closeout input
  and is not claimed by the existence of these documents.

## Rejected Alternatives

- **Empty trusted-list stub instead of `501`:** rejected because the pinned
  client would proceed into key rotation without emergency rewraps.
- **Treat notification delivery as approval:** rejected because mail success or
  loss must not grant or deny vault access.
- **Allow initiate from accepted-but-unconfirmed contacts:** rejected because
  confirmation is the cryptographic handoff.
- **Skip wait after a failed grantor notification:** rejected because
  notification loss never grants access.
- **Reuse organization invite or operator lifecycle as Emergency Access:**
  rejected because this product line is personal delegated recovery, not org
  recovery or operator control.
- **Decrypt or reconstruct `KeyEncrypted` on the server:** rejected because the
  Worker must never decrypt vault keys.
- **Read-then-write status transitions:** rejected because concurrent
  approve/reject/timeout requires one atomic winner.
