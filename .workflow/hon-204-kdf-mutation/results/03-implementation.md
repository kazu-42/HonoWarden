# Packets 02 and 03 result: implementation

Implemented `POST /api/accounts/kdf` with the same credential-proof defense,
notification preflight, generation guard, D1 transaction, and post-commit
notification cleanup boundary as existing password change.

Key invariants:

- the irreversible writer is default-off while PBKDF2/Argon2id readers remain
  active, allowing a reader-capable release to precede later activation
- request authentication/unlock data must have the same unchanged account salt
  and exactly the same new KDF
- PBKDF2-SHA256 and Argon2id bounds are inclusive and use the verified pinned
  server/client intersection, rejecting the server-only 15 MiB Argon2 value
- malformed, missing, unknown, mixed, drifted, stale, concurrent, and failed-D1
  paths cannot partially mutate credential or session state
- authentication hash, wrapped user key, KDF fields, security stamp, revision,
  session revocation, auth-request invalidation, and required audit row form one
  D1 generation
- prelogin, password and refresh token responses, profile, and sync use one
  stored-KDF mapping; unknown stored algorithms fail before session mutation,
  while unknown allowed accounts receive an email-stable, domain-separated
  HMAC decoy spanning the complete accepted PBKDF2 and Argon2id parameter space
- allowed prelogin requires `HONOWARDEN_TOKEN_SECRET` before D1 access and logs
  only a non-secret configuration reason when the secret is absent
- no plaintext password, unwrapped key, hash, wrapped key, token, or request body
  enters audit context or workflow evidence

The implementation also adds a synthetic Wrangler/local-D1 lifecycle command,
an ops regression test, conservative compatibility/current-state/security docs,
and explicit evidence limitations. No schema migration was required because the
initial users table already owns all KDF columns. Every tracked Wrangler
environment remains disabled; only the isolated local lifecycle passes an
explicit flag override.
