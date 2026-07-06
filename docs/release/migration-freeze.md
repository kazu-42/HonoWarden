# Migration Freeze

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

These migration files are frozen for the alpha release line. Do not edit an
already-applied migration. Add a new forward-only migration for future schema
changes and update this document in the same change.

## Frozen Migration Files

| File                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `migrations/0001_initial_schema.sql` | `124d3363d110c5263c78c9742bf67fba8c5a3c4360489fd3c0cbcd710ca6a12f` |
| `migrations/0002_login_defenses.sql` | `4cb168c368cf54ef2017bcbd8539ea44886c9b040cff63ae3ca6f05da5cc7466` |
| `migrations/0003_totp_login.sql`     | `9d2e06deeb9aad154e46ebe50aa18d4ba10e971bcfcc7fb2e393d4f19be6c68c` |

## Required Tables At Freeze

- `schema_migrations`
- `users`
- `devices`
- `refresh_tokens`
- `auth_attempts`
- `auth_failure_buckets`
- `folders`
- `ciphers`
- `user_totp`
- `totp_challenges`

## Policy

- Migration hashes are checked by `test/release-docs.test.ts`.
- Editing a frozen migration requires explicit release-manager approval and a
  new backup/restore drill.
- Adding a migration requires updating this document, `docs/current-state.md`,
  and the release notes.
