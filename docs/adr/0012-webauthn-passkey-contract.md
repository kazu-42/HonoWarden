# ADR 0012: WebAuthn And Passkey Contract

## Status

Accepted

## Context

HonoWarden currently authenticates with a master-password grant, TOTP where
enabled, refresh-token rotation, and the separately scoped Login with Device
flow. It has no WebAuthn route, credential or challenge table, verifier
dependency, access-token method, advertised feature, or live authenticator
evidence. Adding an options endpoint before defining its trust roots would let a
request-derived host or forwarding header become authentication policy.

The pinned official client and server implement both WebAuthn authentication and
an optional PRF-backed Vault-key path. These are not equivalent. A valid
assertion proves control of a credential. Passwordless Vault unlock additionally
requires the exact credential's encrypted PRF key set and client-only PRF
output. The server must never receive or reconstruct that PRF output.

The official browser, extension, desktop, native, and CLI labels also do not
prove that one origin policy works for every host. WebAuthn binds credentials to
an RP ID and browsers verify the calling origin. HonoWarden must name those
values explicitly before any credential state exists.

## Decision

### Explicit Runtime Policy

HonoWarden uses four operator-owned inputs:

- `HONOWARDEN_WEBAUTHN_ENABLED`
- `HONOWARDEN_WEBAUTHN_RP_ID`
- `HONOWARDEN_WEBAUTHN_ORIGINS`
- `HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST`

The policy resolver returns exactly one of `disabled`, `ready`, or
`misconfigured`. Missing, blank, or false enablement is disabled. An ambiguous
enablement value is misconfigured so a typo cannot look like an intentional
shutdown. True enablement is ready only when the complete RP ID and origin set
validate. A misconfigured result is unusable and returns stable error codes,
never a partial allowlist or raw input value.

RP IDs are exact lowercase DNS names with label boundaries, or exact
`localhost` for local development. Schemes, ports, paths, wildcards, trailing
dots, IP addresses, malformed labels, and single-label production names are
rejected. An origin must be an exact URL origin with no credentials, path beyond
`/`, query, fragment, wildcard, or custom scheme. HTTPS is required except for
exact `http://localhost[:port]` when the separate local-development flag is
true. An origin hostname must equal the RP ID or end at a child DNS-label
boundary; `evil-example.com` does not match `example.com`.

The parser permits only scheme/host case folding, an optional root slash, and
removal of an explicit default port. Any other difference between raw input and
the structured URL serialization is invalid. WHATWG repair of backslashes,
dot-segment paths, percent-encoded hosts, Unicode host mapping, embedded control
characters, or non-canonical ports cannot turn malformed input into policy.

The RP ID and accepted origins must not come from `Host`, `Origin`,
`Forwarded`, `X-Forwarded-*`, `CF-Connecting-IP`, or any other request header.
Existing public-URL construction and CORS allowlists are not reusable trust
roots. Request headers may be compared with configured policy later, but they
can never define or widen it.

Tracked Wrangler environments keep enablement false. Real environment RP and
origin values are intentionally absent from tracked configuration. HON-213 owns
the reviewed environment-specific activation and rollback mechanism.

### Protocol And Vault-Key Boundaries

Later implementation preserves the pinned anonymous assertion-options response,
the `grant_type=webauthn` token request with opaque `token` and JSON
`deviceResponse`, and the authenticated credential-management routes recorded in
the WebAuthn contract. The pinned client has no rename request. HonoWarden's
rename is an explicit authenticated extension at
`PUT /api/webauthn/{credentialId}` with a bounded `{ "name": "..." }` body; it
must not be represented as pinned-client compatibility.

Authentication success and Vault unlock remain separate states:

1. A maintained verifier validates challenge, type, origin, RP ID, user
   verification, signature, owner credential, backup state, and counter.
2. The server may establish a device session only after that validation and an
   atomic single-winner challenge transition.
3. A token response includes one WebAuthn PRF decryption option only when the
   asserted credential has a complete encrypted user/public/private-key set.
4. PRF extension output and its derived symmetric key remain client-only. A
   valid assertion without the matching encrypted key set is authentication,
   not passwordless Vault unlock.

The constant PRF salt contract is SHA-256 of `passwordless-login`. It is public
domain separation, not a secret. PRF outputs, derived keys, raw challenges,
credential public keys, user handles, AAGUIDs, and authenticator payloads are
forbidden in logs, audit context, fixtures, issue comments, and evidence.

### Challenge, Credential, And Session Invariants

HON-209 exclusively owns migration 0015, credential/challenge writes, the
maintained verifier dependency, and atomic repository transitions. A challenge
must be purpose-bound, RP-bound, exact-origin-policy-bound, expiring, and single
use. Authenticated ceremonies are account-bound at issuance. Anonymous
discoverable login becomes bound to the verified user handle and owner
credential in the same transaction that consumes the challenge. Caller-supplied
account identity is never authoritative.

Registration and login challenges have a seven-minute maximum. The multi-step
PRF key-set assertion has a 17-minute maximum. HonoWarden deliberately shortens
the pinned server's general 17-minute login assertion token while preserving the
longer key-set window. Concurrent use must produce exactly one winner. Failed
verification changes no challenge, credential counter, device, refresh token,
or session state.

The credential limit is five per user. Positive sign counters may advance only
after successful verification. A positive counter regression fails and records
a security-relevant outcome. Zero remains valid for backup-eligible synced
credentials and must never be converted into a fabricated increment. Backup
eligibility and state are persisted and considered with counter behavior.

Credential rename changes metadata only and does not revoke sessions. PRF
enablement changes only the exact credential's encrypted key set and does not
grant new server-side authentication authority. Credential deletion requires
recent proof and an explicit recovery decision. Recent password proof is the
only currently established independent proof; TOTP alone is not a recovery
path. Deleting the final usable WebAuthn or PRF Vault-unlock path without a
separately proven recovery path fails closed.

Deleting or disabling a credential revokes sessions established from that
credential. If a later token design cannot target those sessions exactly, the
safe fallback is a security-stamp rotation plus refresh-token revocation, not
leaving unknown credential-derived sessions active. HON-211 owns session
provenance; HON-212 owns lifecycle revocation and last-recovery enforcement.

### Errors, Audit, And Retention

Anonymous option and grant failures use generic external errors for malformed
tokens, expired/replayed challenges, unknown users, foreign credentials,
signature failure, RP/origin mismatch, and counter risk. Internal audit may
distinguish reason categories using stable codes and bounded identifiers, but it
must not contain raw policy, credential, challenge, user-handle, public-key,
client-data, authenticator-data, signature, attestation, or PRF values.

Challenge rows receive bounded expiry cleanup. Cleanup never deletes active
credentials. Credential deletion is an authenticated state transition with
session handling, not retention cleanup. Exact retention periods and bounded
batch behavior belong to HON-209, which must integrate with the existing
idempotent scheduled cleanup path.

### Capability Stages And Ownership

The rollout has separate claims:

1. HON-208: contract and pure default-off policy parser only.
2. HON-209: source capability for schema, verifier, and repository core; no
   route.
3. HON-210 and HON-211: enrollment/inventory and assertion/session/PRF source
   behavior.
4. HON-212: PRF enablement, rename, delete, recovery, and session revocation.
5. HON-213: environment activation, compatibility fixtures, and rollback gate.
6. HON-214: staged real-authenticator evidence and compatibility promotion.

Source capability, environment activation, official-client evidence, and
compatibility promotion are never inferred from one another. Until the owning
child passes, routes remain absent and `/config` advertises no WebAuthn or
passkey feature.

## Rejected Alternatives

- **Derive RP ID from the request host:** rejected because proxies and forwarded
  headers are request-controlled inputs and can silently widen trust.
- **Accept wildcard or arbitrary extension origins:** rejected because a single
  browser result is not evidence for every extension, desktop, or native host.
- **Treat assertion as Vault unlock:** rejected because the pinned client needs
  local PRF output plus the exact encrypted key set.
- **Implement CBOR, COSE, or signature parsing locally:** rejected because a
  maintained verifier library is required and owned by HON-209.
- **Return a reduced valid allowlist after parsing errors:** rejected because
  partial configuration makes operator intent ambiguous.
- **Count TOTP as an independent recovery method:** rejected because it is a
  second factor layered on account authentication, not a standalone Vault-key
  recovery path.
- **Copy the pinned read-then-set replay cache:** rejected because concurrent
  challenge use requires one atomic winner.

## Consequences

- HON-208 can be rolled back by removing unused parsing and documentation. It
  creates no schema, credential, challenge, session, user, route, dependency,
  binding value, or runtime capability.
- Later route work has one trust-policy input and cannot silently reuse public
  origin or CORS behavior.
- Local HTTP testing requires an obvious extra opt-in and cannot normalize
  loopback IPs or sibling names into `localhost`.
- Strict configuration can produce an intentional startup/route failure after a
  future activation typo. This loud failure is preferable to accepting the wrong
  origin; rollback is setting enablement false and reading back route absence.
- Official-client compatibility remains unclaimed until HON-214 records host-
  specific, staged, real-authenticator evidence.
