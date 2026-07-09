# Access Token Key Rotation

Last reviewed: 2026-07-09.

Status: code-supported. No live production access-token key rotation drill has
been executed yet.

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

## Normal Staged Rotation

1. Confirm the deployed commit includes access-token keyring support.
2. Generate a new high-entropy active signing secret outside the repository.
3. Set staging secrets:

```sh
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID --env staging
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET --env staging
pnpm wrangler secret put HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS --env staging
```

Use an empty JSON array (`[]`) for `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS` on
the first staged keyring rollout. Keep `HONOWARDEN_TOKEN_SECRET` unchanged.

4. Verify staging:

```sh
pnpm exec vitest run test/domain/tokens.test.ts test/app.test.ts
pnpm check
```

Then run live staging health, synthetic prelogin, password grant, refresh grant,
and authenticated sync smoke with redacted evidence only.

5. Promote the same reviewed keyring plan to production only after staging
   passes.
6. On the next rotation, move the old active key into
   `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`, set a new active `kid` and secret,
   and verify that new tokens carry the new `kid` while old tokens from the
   previous key still verify.
7. Retire previous keys only after at least the maximum access-token TTL plus an
   operator-approved safety window. HonoWarden access tokens currently expire in
   one hour.

## Rollback

Prefer restoring the last known-good keyring over removing all keyring
variables. Removing the keyring returns the Worker to legacy verification and
will invalidate still-live tokens that were already signed with an active
`kid`, although refresh-token grants can issue new access tokens if
`HONOWARDEN_TOKEN_SECRET` and refresh sessions are still valid.

Rollback options:

- restore the previous active and previous-key JSON values
- move the last working active key into `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`
  and set a new active key
- remove a compromised previous key from the verifier set after confirming the
  blast radius and reauth plan
- rotate `HONOWARDEN_TOKEN_SECRET` only for refresh-token or legacy no-kid
  fallback exposure; this is a forced re-login event and belongs to a separate
  operator-owned live secret rotation window

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
