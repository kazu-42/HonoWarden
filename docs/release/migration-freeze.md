# Migration Freeze

Target: `v0.1.0-alpha`.

Last updated: 2026-07-10.

These migration files are frozen for the alpha release line. Do not edit an
already-applied migration. Add a new forward-only migration for future schema
changes and update this document in the same change.

## Frozen Migration Files

| File                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `migrations/0001_initial_schema.sql`     | `124d3363d110c5263c78c9742bf67fba8c5a3c4360489fd3c0cbcd710ca6a12f` |
| `migrations/0002_login_defenses.sql`     | `4cb168c368cf54ef2017bcbd8539ea44886c9b040cff63ae3ca6f05da5cc7466` |
| `migrations/0003_totp_login.sql`         | `9d2e06deeb9aad154e46ebe50aa18d4ba10e971bcfcc7fb2e393d4f19be6c68c` |
| `migrations/0004_totp_change.sql`        | `b03ccec7b6e9d689d4cb9b40c3d235844875ef5fab8050d43862e0953aff62fb` |
| `migrations/0005_device_keys.sql`        | `97071b22d753636c4f9a0fe4c699f0c3802c47f30ae235fd45e9d76137d275e0` |
| `migrations/0006_cipher_attachments.sql` | `7b4328e31fc34c775c5971ada17c92ec44e89bc889a363c24b6beaa2d4b4e0c0` |
| `migrations/0007_audit_events.sql`       | `34e1661295fc9f521d898bca587f167a280fa490681d83e327828d43d326239d` |
| `migrations/0008_request_quotas.sql`     | `fe2955c3733bc4907b0e6711b9c37257dfa67e5973c7495d06bb847ed84ee884` |
| `migrations/0010_equivalent_domains.sql` | `4a6b2f2da77103955d78ed132afc8a1519ba4c0a59f50a6a4fdfb4194e6dc559` |
| `migrations/0011_inquiry_inbox.sql`      | `a8c9524b32ecd398d540b052dbb6e96fc3dc500669ca6806089162c21b857bb8` |
| `migrations/0012_auth_requests.sql`      | `71fc9ca16ea9dd2e6e8dbe9c7c93cc2899b8375b482eaeaf3a673b6d01b50b3d` |

## Required Tables At Freeze

- `schema_migrations`
- `users`
- `devices`
- `refresh_tokens`
- `auth_attempts`
- `auth_failure_buckets`
- `request_quota_buckets`
- `folders`
- `ciphers`
- `cipher_attachments`
- `audit_events`
- `inquiry_threads`
- `inquiry_messages`
- `inquiry_events`
- `auth_requests`
- `user_totp`
- `totp_challenges`

## Policy

- Migration hashes are checked by `test/release-docs.test.ts`.
- Editing a frozen migration requires explicit release-manager approval and a
  new backup/restore drill.
- Adding a migration requires updating this document, `docs/current-state.md`,
  and the release notes.
