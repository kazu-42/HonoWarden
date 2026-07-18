# WebAuthn Wire And State Contract

Status: contract only; no HonoWarden WebAuthn route is implemented or enabled.

## Source Baseline

This contract was inspected against immutable official source pins:

- clients `web-v2026.6.1`, commit
  `39f07436ca60e3f25eac47777671754f288a98f1`
- server `v2026.6.1`, commit
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`

The pins establish the compatible wire shape. HonoWarden-specific security
improvements and extensions are called out explicitly. This document does not
copy product UI, private behavior, or hosted-service internals.

## Runtime Trust Contract

`resolveWebAuthnRuntimePolicy` is the only planned input to all ceremony routes.
It produces:

- `disabled`: no route may issue or consume a WebAuthn challenge;
- `ready`: exact configured RP ID and canonical origin array are available;
- `misconfigured`: no route may continue and only stable error codes are
  observable.

RP/origin values are operator configuration, never values discovered from a
request. The origin list is bounded at 16 entries before deduplication and is
returned sorted. RP `example.com` accepts `https://example.com` and
`https://vault.example.com`, but not `https://evil-example.com`. Only exact
localhost can use HTTP and only with the dedicated opt-in. Browser-extension,
custom-scheme, desktop, native, and CLI hosts require later explicit design and
evidence; they are not accepted by this policy.

Raw origin input may differ from canonical output only by scheme/host case, an
optional root slash, or an explicit default port. Backslash repair, normalized
dot segments, percent-encoded or Unicode-mapped hosts, embedded controls, and
non-canonical ports are rejected before the structured URL result is trusted.

## Pinned Endpoint Surface

| Purpose                    | Method and HonoWarden path                          | Authentication                                  | Pinned body or response                                                                                    |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Discoverable login options | `GET /identity/accounts/webauthn/assertion-options` | anonymous, quota bounded                        | response `{ options, token }`                                                                              |
| WebAuthn token grant       | `POST /identity/connect/token`                      | assertion token and credential response         | form `grant_type=webauthn`, opaque `token`, JSON-stringified `deviceResponse`, normal client/device fields |
| List credentials           | `GET /api/webauthn`                                 | bearer owner                                    | list of owner credential summaries                                                                         |
| Registration options       | `POST /api/webauthn/attestation-options`            | bearer owner plus supported recent secret proof | creation options and opaque token                                                                          |
| Create credential          | `POST /api/webauthn`                                | bearer owner plus registration response         | attestation response, name, token, PRF support, optional encrypted key triple                              |
| PRF assertion options      | `POST /api/webauthn/assertion-options`              | bearer owner plus supported recent secret proof | assertion options and opaque token                                                                         |
| Enable PRF key set         | `PUT /api/webauthn`                                 | bearer owner plus scoped assertion              | assertion response, token, complete encrypted key triple                                                   |
| Delete credential          | `POST /api/webauthn/{credentialId}/delete`          | bearer owner plus supported recent secret proof | no credential material in response                                                                         |
| Rename credential          | `PUT /api/webauthn/{credentialId}`                  | bearer owner                                    | HonoWarden extension with bounded `{ "name": "..." }`                                                      |

The rename route is not present in the pinned client. It cannot count as
official-client compatibility and belongs to HON-212.

## Anonymous Assertion And Grant

The anonymous options endpoint returns discoverable assertion options. The
allow-credentials list is empty, user verification is required, and the response
contains an opaque server token separate from the WebAuthn challenge. The token
is only a handle to one purpose/RP/origin/expiry policy; it is not account proof
and must not encode a reusable raw challenge in logs or evidence.

The client decodes base64url challenge and credential IDs, calls the platform
credential API, and posts the token grant. `deviceResponse` is JSON containing
the credential id/type/raw id and assertion response fields such as client data
JSON, authenticator data, signature, and user handle. Exact casing follows the
pinned client DTO. Extension results are not trusted input. In particular, PRF
output is deliberately kept client-side and must not be accepted in this JSON.

Grant processing order is mandatory:

1. Parse a bounded form and opaque token without logging either payload.
2. Load one unexpired authentication-purpose challenge by a protected token
   hash and the active RP/origin policy version.
3. Parse the user handle only as verifier input; do not accept a separate
   caller-supplied account id.
4. Load the exact credential owner and require the asserted credential to
   belong to that owner.
5. Use the maintained verifier for challenge, origin, RP ID, user verification,
   signature, authenticator data, backup flags, and counter semantics.
6. In one recoverable single-winner transition, consume the challenge, update
   the successful counter/backup state, and establish credential provenance for
   the device session. Concurrent attempts yield exactly one session.
7. Only then run existing active-user, device, refresh-token, account-policy,
   security-stamp, and access-token issuance rules.

The access token uses a distinct `webauthn` authentication method. It does not
silently satisfy current recent-password checks. HON-211 must make the TOTP
interaction explicit because the pinned client cannot continue a WebAuthn grant
through a two-factor challenge. A successful assertion must not bypass an
enabled TOTP policy by accident, and an unsupported continuation must fail
clearly before session creation.

## Registration And Inventory

Registration requires a recent, explicitly supported proof before options are
issued. The current HonoWarden helper proves a password-issued access token no
older than five minutes. Later code may translate the pinned
`SecretVerificationRequest`, but it must not broaden the existing helper to
refresh-authenticated or claimless tokens without a separate decision and tests.

Creation options require:

- resident/discoverable credential;
- user verification required;
- no attestation conveyance;
- account UUID bytes as the stable WebAuthn user id representation;
- the exact configured RP ID;
- an exclude list of that owner's existing credential IDs;
- a seven-minute registration challenge.

The server verifies attestation before writing any row. Credential ID uniqueness
is global enough to prevent ambiguous owner lookup, while every read/list/mutate
operation is owner-scoped. A user may have at most 5 credentials. The sixth
attempt fails before persistence. List output exposes only the server row id,
bounded user-selected name, PRF status, revision/creation metadata required by
the client, and encrypted user/public keys required by the pinned response. It
does not expose the COSE public key, user handle, challenge, AAGUID, counter,
attestation object, or raw credential ID bytes beyond fields strictly required
by the authenticated owner contract.

## PRF And Vault Unlock

The pinned client computes the PRF salt as `SHA-256("passwordless-login")` and
derives encryption/MAC material locally. During registration or later
enablement, the server receives only an encrypted user/public/private-key
triple. It never receives the PRF result or derived symmetric key.

PRF state has three meanings:

- `unsupported`: the authenticator did not report PRF support;
- `supported`: PRF is supported but no complete encrypted key triple exists;
- `enabled`: support is true and all three encrypted key values are present.

Partial triples are invalid and never produce `enabled`. PRF enablement uses an
assertion challenge scoped only to the exact owner credential and key-set update,
with a 17-minute maximum for the multi-ceremony client flow. It cannot rename,
delete, authenticate another credential, or change account/session authority.

After a login assertion, the token response may include exactly one
`UserDecryptionOptions.WebAuthnPrfOption`, selected by the exact asserted
credential. It contains the encrypted private key, encrypted user key,
credential identifier required by the client, and stored transports. Returning
another credential's key set is a cross-credential substitution defect. If the
key triple is absent or partial, authentication may succeed but passwordless
Vault unlock has not succeeded and must not be advertised.

## Challenge State

HON-209 owns migration 0015 and all challenge writes. Each stored challenge
record must include or cryptographically bind:

- a protected hash of the opaque route token and a protected hash/check of the
  challenge rather than reusable plaintext at rest;
- ceremony purpose: registration, authentication, or PRF key-set update;
- account id for authenticated ceremonies;
- verified credential owner binding at anonymous authentication consumption;
- exact RP ID and an immutable origin-policy version or equivalent canonical
  origin-set digest;
- issue and expiry timestamps;
- one consumed timestamp/state and bounded retention metadata.

Registration and authentication expire after at most seven minutes. PRF
key-set update expires after at most 17 minutes. Expiry never slides on reads or
failed attempts. Purpose, account, RP, origin policy, or credential mismatch is
not recoverable by rewriting the row. Consumption and successful state updates
are atomic and single-winner; the pinned server's separate replay-cache read and
set is not copied.

Anonymous authentication is necessarily account-agnostic at issuance. It
becomes account-bound only from the verifier-checked user handle and matching
owner credential, in the same transaction as consumption. This exception does
not permit email, user id, or credential owner supplied elsewhere in the request
to select the account.

## Credential State And Counter Rules

HON-209 persistence records owner, unique credential id, COSE public key, stable
user handle, sign count, credential type, transports, AAGUID, discoverability,
backup eligibility/state, PRF support/state, complete encrypted key fields,
bounded name, creation/revision/last-used timestamps, and any disabled/deleted
state required by lifecycle policy.

Counter updates occur only after complete verifier success. For a credential
with positive monotonic counters, a positive regression fails without updating
the row. Counter zero remains zero when valid for a backup-eligible synced
passkey; the server does not manufacture an increment. Backup state changes are
recorded from verified authenticator data and evaluated together with counter
behavior. Counter risk is auditable by a stable reason code without credential
bytes or authenticator payload.

## Recovery And Session Effects

Credential creation does not prove that PRF Vault unlock works. PRF enablement
does not create a new login session. Rename is metadata-only. Delete is a
security transition:

- it requires current owner authorization and recent supported proof;
- it refuses to remove the last usable WebAuthn/PRF recovery path unless an
  independent recovery path has just been proven;
- recent password proof counts as the currently implemented independent path;
- TOTP alone does not count as independent account or Vault-key recovery;
- it revokes refresh/access sessions established from the deleted credential;
- if exact credential provenance cannot be revoked, rotate the account security
  stamp and revoke refresh tokens rather than leave uncertain sessions active.

Existing access-token verification continues to re-read disabled account and
security-stamp state. A deleted credential can never be used to refresh or
re-establish a session. Rollback disables route access but never un-consumes a
challenge, restores a deleted credential, rolls a counter backward, or
down-migrates authentication data.

## Errors, Quotas, Audit, And Retention

Anonymous options and grant endpoints use persistent bounded network/device and
eventual account quotas. External responses are enumeration-safe across unknown
user handle, unknown/foreign credential, malformed token, expiry, replay,
RP/origin mismatch, signature failure, missing user verification, and counter
risk. Authenticated management may return stable owner-scoped validation errors
without exposing another account's existence.

Audit records may distinguish issue, verify, consume, replay, expiry, quota,
create, rename, PRF enable, delete, recovery refusal, counter risk, and session
revocation. They must not include raw configuration values, raw challenges,
opaque route tokens, credential IDs or public keys, user handles, AAGUIDs,
attestation/assertion objects, client/authenticator data, signatures, PRF output,
derived keys, or encrypted private key material. Evidence uses synthetic counts
and stable reason categories only.

Scheduled cleanup deletes bounded expired/consumed challenge slices. It never
deletes active credentials or session state. Retention failure is observable and
retryable; it must not make expired challenges usable again.

## Child Ownership And Evidence Gates

| Child   | Exclusive responsibility                                                          | Completion evidence                                                       |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| HON-208 | this contract, ADR, threat model, pure policy parser                              | focused and full source gates; routes and capability remain absent        |
| HON-209 | migration 0015, verifier dependency, credential/challenge repositories, cleanup   | Workers bundle dry-run, repository concurrency/isolation tests, no routes |
| HON-210 | registration options/create/list                                                  | official-shaped fixtures and failure/no-partial-write tests               |
| HON-211 | anonymous assertion, grant, session provenance, PRF token response, TOTP decision | one-winner session tests and client-shaped fixtures                       |
| HON-212 | PRF enablement, HonoWarden rename, delete, recovery, session revoke               | lifecycle/recovery and revocation tests                                   |
| HON-213 | default-off route integration, environment activation, rollback                   | config/route matrix and deployment dry-run; no production enablement      |
| HON-214 | staged host/authenticator verification and capability promotion                   | approved real-authenticator matrix with redacted readback                 |

No source child may promote browser extension, Web, Desktop, mobile, CLI,
localhost, custom-domain, staging, or production compatibility. HON-214 owns
those claims after host-specific evidence.
