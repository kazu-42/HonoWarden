# Access Token Key Rotation

Last reviewed: 2026-07-09.

Status: code-supported, live secret/config write **STOP**.

No live production access-token key rotation drill has been executed yet. This
runbook does not authorize a staging or production secret mutation.

This runbook covers staged rotation of HonoWarden access-token signing keys. It
does not rotate `HONOWARDEN_TOKEN_SECRET`, refresh tokens, TOTP wrapping
secrets, Cloudflare credentials, or operator credentials.

## Runtime Contract

- `HONOWARDEN_TOKEN_SECRET` remains required. It hashes refresh tokens and
  verifies legacy no-kid access tokens during migration.
- `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID` and
  `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET` enable key-id access-token signing.
  New access tokens include the active JWT `kid`.
- `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS` is a JSON array of previous signing
  keys, for example:

```json
[
  {
    "kid": "2026-07-previous",
    "secret": "redacted-previous-secret"
  }
]
```

- Previous keys verify existing access tokens only. They never sign new tokens.
- Unknown `kid` values fail closed and do not fall back to
  `HONOWARDEN_TOKEN_SECRET`.
- Missing, partial, malformed, or duplicate keyring config fails closed with
  `server_misconfigured`.
- If no access-token keyring variables are configured, the Worker keeps the
  legacy behavior: sign and verify access tokens with `HONOWARDEN_TOKEN_SECRET`
  and no JWT `kid`.

## Current STOP And Future Rotation Admission

Do not set, rotate, delete, or copy HonoWarden API Worker secrets from this
runbook. Explicit operator approval or the presence of a credential is not, by
itself, execution authority. The repository currently provides no admitted
writer for this rotation.

A future rotation requires a separately reviewed secret/config/deploy protocol
that records all of the following before any mutation:

1. the exact Cloudflare account, environment, Worker, and three-key keyring
   target;
2. the exact scoped credential source and a clean-shell proof that ambient
   global-key or Wrangler OAuth authentication cannot take precedence;
3. secret-safe pre-readback of the current key-set shape, active `kid`, Worker
   version, and reviewed source provenance;
4. the ordered mutation plan, including the intended empty previous-key array
   (`[]`) for a first rollout and the invariant that
   `HONOWARDEN_TOKEN_SECRET` remains unchanged;
5. secret-safe post-readback and staging health, synthetic prelogin, password
   grant, refresh grant, and authenticated sync smoke;
6. explicit classification of zero-write failure, partial-success/config-drift,
   and complete success; and
7. recovery for every partial state, with the last known-good keyring and
   reader-capable Worker target identified in advance.

The protocol must stop before production promotion unless staging readback and
all smoke checks match the reviewed target. Promotion is a separate reviewed
mutation, not an automatic continuation of staging success.

Local verification remains safe and available:

```sh
pnpm exec vitest run test/domain/tokens.test.ts test/app.test.ts
pnpm check
```

These tests prove source behavior only; they do not read or mutate a deployed
Worker. In an admitted future rotation, move the old active key into
`HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`, set a new active `kid` and secret, and
verify that new tokens carry the new `kid` while old tokens from the previous
key still verify. Retire previous keys only after at least the maximum
access-token TTL plus a separately reviewed safety window. HonoWarden access
tokens currently expire in one hour.

## Rollback

Prefer restoring the last known-good keyring over removing all keyring
variables. Removing the keyring returns the Worker to legacy verification and
will invalidate still-live tokens that were already signed with an active
`kid`, although refresh-token grants can issue new access tokens if
`HONOWARDEN_TOKEN_SECRET` and refresh sessions are still valid.

Recovery options for a future admitted protocol:

- restore the previous active and previous-key JSON values
- move the last working active key into `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`
  and set a new active key
- remove a compromised previous key from the verifier set after confirming the
  blast radius and reauth plan
- rotate `HONOWARDEN_TOKEN_SECRET` only for refresh-token or legacy no-kid
  fallback exposure; this is a forced re-login event and belongs to a separate
  reviewed live secret-rotation protocol

## Evidence To Record

Record only non-secret evidence:

- issue ID, owner, environment, and UTC timestamp
- commit SHA and Worker version/deployment identifiers
- redacted `kid` names or hash tags, never secret values
- whether `HONOWARDEN_TOKEN_SECRET` was unchanged
- focused test output and full release gate output
- live health, token exchange, refresh grant, and sync smoke status
- rollback decision and exact non-secret rollback plan

Do not record bearer tokens, refresh tokens, signing secrets, previous-key JSON
values, cookies, password hashes, encrypted vault payloads, or private operator
addresses.
