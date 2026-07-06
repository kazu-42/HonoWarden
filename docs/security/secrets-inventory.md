# Secrets Inventory

Last reviewed: 2026-07-06.

This inventory distinguishes true secrets from sensitive operational artifacts.
Do not commit real secret values to the repository.

## Runtime Secrets

| Name                         | Required For                                   | Storage                      | Rotation Trigger                                                 | Failure Mode                                        |
| ---------------------------- | ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `HONOWARDEN_BOOTSTRAP_TOKEN` | restricted account bootstrap                   | Wrangler secret or local env | suspected exposure, operator change, after bootstrap window      | bootstrap returns forbidden or disabled             |
| `HONOWARDEN_TOKEN_SECRET`    | access-token signing and refresh-token hashing | Wrangler secret or local env | suspected exposure, release key rotation, environment compromise | token exchange and authenticated routes fail closed |
| `HONOWARDEN_TOTP_SECRET`     | AES-GCM wrapping of TOTP setup secrets         | Wrangler secret or local env | suspected exposure or planned TOTP re-enrollment event           | TOTP setup/login fails closed                       |

## Runtime Configuration

| Name                           | Secret?                         | Security Role                                           |
| ------------------------------ | ------------------------------- | ------------------------------------------------------- |
| `HONOWARDEN_ALLOWED_EMAILS`    | no, but operationally sensitive | restricts bootstrap/prelogin account set                |
| `HONOWARDEN_BOOTSTRAP_ENABLED` | no                              | keeps bootstrap default-off                             |
| `HONOWARDEN_AUDIT_LOGS`        | no                              | controls audit JSON-line emission                       |
| `HONOWARDEN_ENV`               | no                              | separates development, staging, and production behavior |

## Sensitive Stored Data

| Data                          | Location                                 | Notes                                                 |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| master password hash          | D1 `users.master_password_hash`          | never log; not plaintext password                     |
| user key/private key payloads | D1 `users.user_key`, `users.private_key` | opaque encrypted payloads                             |
| refresh-token hash            | D1 `refresh_tokens.token_hash`           | derived with token secret and presented refresh token |
| device identifiers and names  | D1 `devices`                             | operational metadata; treat as sensitive              |
| encrypted folder names        | D1 `folders.encrypted_name`              | ciphertext but still sensitive backup material        |
| encrypted cipher JSON         | D1 `ciphers.encrypted_json`              | ciphertext; server must not parse plaintext           |
| encrypted TOTP setup secret   | D1 `user_totp.encrypted_secret`          | AES-GCM envelope under TOTP secret                    |
| TOTP challenge hash           | D1 `totp_challenges.challenge_hash`      | single-use, expiring, device-bound                    |
| auth failure bucket keys      | D1 `auth_*` tables                       | hashed bucket metadata, not raw IP                    |
| audit event lines             | Cloudflare logs                          | sensitive operational metadata                        |
| backup directories            | operator filesystem                      | include D1 dump, manifest, and optional R2 objects    |

## Rotation Notes

- Token secret rotation invalidates existing access tokens and refresh-token
  hash lookups. Plan a forced re-login window.
- TOTP secret rotation requires re-wrapping or re-enrolling TOTP setup secrets.
  There is no migration tool yet.
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
