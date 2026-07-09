# Secrets Inventory

Last reviewed: 2026-07-09.

This inventory distinguishes true secrets from sensitive operational artifacts.
Do not commit real secret values to the repository.

## Runtime Secrets

| Name                                    | Required For                                                                  | Storage                      | Rotation Trigger                                                 | Failure Mode                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `HONOWARDEN_BOOTSTRAP_TOKEN`            | restricted account bootstrap                                                  | Wrangler secret or local env | suspected exposure, operator change, after bootstrap window      | bootstrap returns forbidden or disabled             |
| `HONOWARDEN_TOKEN_SECRET`               | refresh-token hashing and legacy no-kid access-token fallback                 | Wrangler secret or local env | suspected exposure, release key rotation, environment compromise | token exchange and authenticated routes fail closed |
| `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET` | active key-id access-token signing when staged key rotation is enabled        | Wrangler secret or local env | suspected exposure, staged access-token key rotation             | token exchange and authenticated routes fail closed |
| `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS` | previous key-id access-token verification during a staged access-token rotate | Wrangler secret or local env | previous key retirement after token TTL and safety window        | token exchange and authenticated routes fail closed |
| `HONOWARDEN_TOTP_SECRET`                | AES-GCM wrapping of TOTP setup secrets                                        | Wrangler secret or local env | suspected exposure or planned TOTP re-enrollment event           | TOTP setup/login fails closed                       |

## Runtime Configuration

| Name                                 | Secret?                                        | Security Role                                                 |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------- |
| `HONOWARDEN_ALLOWED_EMAILS`          | no, but operationally sensitive                | restricts bootstrap/prelogin account set                      |
| `HONOWARDEN_BOOTSTRAP_ENABLED`       | no                                             | keeps bootstrap default-off                                   |
| `HONOWARDEN_AUDIT_LOGS`              | no                                             | controls audit JSON-line emission                             |
| `HONOWARDEN_ENV`                     | no                                             | separates development, staging, and production behavior       |
| `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID` | no, but rotate with the matching active secret | identifies the active access-token signing key in JWT headers |

## Sensitive Stored Data

| Data                          | Location                                 | Notes                                                 |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| master password hash          | D1 `users.master_password_hash`          | never log; not plaintext password                     |
| user key/private key payloads | D1 `users.user_key`, `users.private_key` | opaque encrypted payloads                             |
| refresh-token hash            | D1 `refresh_tokens.token_hash`           | derived with token secret and presented refresh token |
| device identifiers and names  | D1 `devices`                             | operational metadata; treat as sensitive              |
| encrypted folder names        | D1 `folders.encrypted_name`              | ciphertext but still sensitive backup material        |
| encrypted cipher JSON         | D1 `ciphers.encrypted_json`              | ciphertext; server must not parse plaintext           |
| attachment metadata           | D1 `cipher_attachments`                  | encrypted filename/key plus opaque R2 object pointer  |
| attachment object bodies      | R2 `attachments/<uuid>`                  | opaque encrypted bytes; no plaintext server access    |
| encrypted TOTP setup secret   | D1 `user_totp.encrypted_secret`          | AES-GCM envelope under TOTP secret                    |
| TOTP challenge hash           | D1 `totp_challenges.challenge_hash`      | single-use, expiring, device-bound                    |
| auth failure bucket keys      | D1 `auth_*` tables                       | hashed bucket metadata, not raw IP                    |
| audit event rows and lines    | D1 `audit_events`, Cloudflare logs       | sensitive operational metadata                        |
| backup directories            | operator filesystem                      | include D1 dump, manifest, and optional R2 objects    |

## Rotation Notes

- Formal multi-credential drill coverage is recorded in
  [Formal Secret Rotation Drill](../operations/secret-rotation-drill.md), with
  dry-run evidence in
  [Secret Rotation Drill Evidence](../release/secret-rotation-drill-evidence.md).
  The drill records environment variable names, configured/missing booleans,
  blast radius, verification commands, and rollback paths only; it does not
  rotate or print real secrets.
- Access-token key rotation should use
  [Access Token Key Rotation](../operations/access-token-key-rotation.md).
  The active key signs new tokens with a JWT `kid`, previous keys verify tokens
  issued before the rotate, and `HONOWARDEN_TOKEN_SECRET` remains the legacy
  no-kid fallback while refresh-token hashes are preserved.
- `HONOWARDEN_TOKEN_SECRET` rotation invalidates existing refresh-token hash
  lookups and legacy no-kid access-token fallback. Plan forced re-login and
  session invalidation when that secret is affected.
- Partial or malformed access-token keyring configuration fails closed instead
  of silently falling back to `HONOWARDEN_TOKEN_SECRET`.
- TOTP secret rotation should use
  [TOTP Secret Rotation](../operations/totp-secret-rotation.md). Rewrap keeps
  TOTP enabled by re-encrypting active and pending envelopes; force
  re-enrollment deletes TOTP rows and requires explicit operator approval.
- Bootstrap token should be short-lived operationally even if the route remains
  disabled by default.
- Production secrets must be set with Wrangler secret commands, not
  `wrangler.jsonc` vars.

## Handling Rules

- Never paste secret values, bearer tokens, refresh tokens, password hashes, or
  encrypted vault payloads into issues, Linear, logs, or chat.
- Redact `Authorization`, cookies, token fields, and request/response bodies from
  diagnostic evidence.
- Treat backups as sensitive and delete failed restore targets after triage.
