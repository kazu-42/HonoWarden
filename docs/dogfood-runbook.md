# Dogfood Runbook

This runbook defines the first low-risk dogfood loop for HonoWarden.

The purpose is to exercise the API with official upstream clients while avoiding real secrets, production-only changes, or ambiguous evidence.

## Scope

Allowed during first dogfood:

- one allowlisted operator account
- synthetic login entries with fake domains, usernames, and passwords
- synthetic secure notes with no real personal or business data
- folder create, edit, delete, and sync
- cipher create, edit, trash, restore, permanent delete, and sync
- refresh token rotation and device revoke checks

Not allowed during first dogfood:

- real passwords, recovery codes, seed phrases, API keys, private keys, or vault exports
- public registration
- organization, collection, sharing, send, or web app flows
- production promotion without staging evidence

## Environment Separation Checks

Before dogfood, run:

```sh
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
```

Confirm:

- `GET /health` returns `environment: "staging"` on staging.
- `GET /health` returns `environment: "production"` on production.
- staging and production use different Worker names.
- staging and production use different D1 database names.
- staging and production use different R2 bucket names.
- bootstrap is disabled by default in both deployable environments.

## Staging Loop

1. Deploy staging only after tests pass.
2. Apply migrations to staging D1.
3. Set staging secrets and allowlist exactly one operator email.
4. Bootstrap the operator account.
5. Login from one browser-extension or desktop client.
6. Confirm empty sync completes.
7. Create one synthetic folder and one synthetic login item.
8. Logout, login again, and confirm the item syncs back.
9. Edit, trash, restore, and permanently delete the synthetic item.
10. Revoke a second test device if available.
11. Record evidence without tokens, cookies, real addresses, or vault payload plaintext.

## Production Promotion Gate

Promote only when all are true:

- staging dogfood ran without daily breakage for the intended window
- no compatibility regression is open
- no migration rollback uncertainty remains for the tested schema
- unsupported feature behavior is explicit
- backup and restore requirements for the target release are not being claimed early

## Abort Conditions

Abort dogfood and rotate affected secrets if any of these occur:

- real secret material is entered into the vault
- logs contain access tokens, refresh tokens, passwords, or decrypted vault contents
- staging and production point at the same storage resource
- refresh token reuse is accepted
- cross-user data appears in sync
- unsupported feature flows silently no-op instead of returning an explicit error

## Evidence Format

Store future live evidence as a short Markdown or JSON artifact that records:

- timestamp
- environment
- client surface and exact version
- synthetic scenario name
- endpoint flow summary
- result
- known issue link or note

Do not store raw tokens, cookies, authorization headers, vault export files, or plaintext vault values.
