# Migration Freeze

Target: `v0.1.0-alpha`.

Last updated: 2026-10-04.

These migration files are frozen for the alpha release line. Do not edit an
already-applied migration. Add a new forward-only migration for future schema
changes and update this document in the same change.

## Frozen Migration Files

| File                                                          | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `migrations/0001_initial_schema.sql`                          | `124d3363d110c5263c78c9742bf67fba8c5a3c4360489fd3c0cbcd710ca6a12f` |
| `migrations/0002_login_defenses.sql`                          | `4cb168c368cf54ef2017bcbd8539ea44886c9b040cff63ae3ca6f05da5cc7466` |
| `migrations/0003_totp_login.sql`                              | `9d2e06deeb9aad154e46ebe50aa18d4ba10e971bcfcc7fb2e393d4f19be6c68c` |
| `migrations/0004_totp_change.sql`                             | `b03ccec7b6e9d689d4cb9b40c3d235844875ef5fab8050d43862e0953aff62fb` |
| `migrations/0005_device_keys.sql`                             | `97071b22d753636c4f9a0fe4c699f0c3802c47f30ae235fd45e9d76137d275e0` |
| `migrations/0006_cipher_attachments.sql`                      | `7b4328e31fc34c775c5971ada17c92ec44e89bc889a363c24b6beaa2d4b4e0c0` |
| `migrations/0007_audit_events.sql`                            | `34e1661295fc9f521d898bca587f167a280fa490681d83e327828d43d326239d` |
| `migrations/0008_request_quotas.sql`                          | `fe2955c3733bc4907b0e6711b9c37257dfa67e5973c7495d06bb847ed84ee884` |
| `migrations/0009_inquiry_messages.sql`                        | `3400d862d2d10da455a93b6fd739f534b55f22aa1c526b3283581bab672a4aeb` |
| `migrations/0010_equivalent_domains.sql`                      | `4a6b2f2da77103955d78ed132afc8a1519ba4c0a59f50a6a4fdfb4194e6dc559` |
| `migrations/0010a_inquiry_message_reconciliation.sql`         | `27fc086baf750bfb75719581e4d7fbfd359b219a2ae6f60c174539a58422ab84` |
| `migrations/0011_inquiry_inbox.sql`                           | `a8c9524b32ecd398d540b052dbb6e96fc3dc500669ca6806089162c21b857bb8` |
| `migrations/0012_auth_requests.sql`                           | `71fc9ca16ea9dd2e6e8dbe9c7c93cc2899b8375b482eaeaf3a673b6d01b50b3d` |
| `migrations/0013_auth_request_supersede.sql`                  | `ad47a1465ca857903c97d837a943ace3ca2505ff20197e6533259c2154f6ac86` |
| `migrations/0014_organizations.sql`                           | `95cc696e345d309a32e548f44e7ab7ebd91e8b2ba335f59c2048e36b9f27f9cb` |
| `migrations/0014a_kdf_population.sql`                         | `96ec8647d11519c99ff14b88b89a0213472f5ad5c3af618adea958b9f920657f` |
| `migrations/0015_webauthn.sql`                                | `e342fece7a091ffb60a3b2f55fbae0ef8fc2c6197216e891030bde6f655a6915` |
| `migrations/0016_user_key_rotation_wrapper_history.sql`       | `5c99ca3973711d0031ed2b48bed77f3191ec2773af9ae570b1e48f5dfae209ac` |
| `migrations/0017_account_lifecycle.sql`                       | `5ed91a78fea52d661b07bdebbc4d74654b4bab0a84010829874202bd6bf219dc` |
| `migrations/0018_text_sends.sql`                              | `c4cc6047f2e2bebcc9d15ff034be340785a06e6c0d1fe39560a53cf0d32bf2de` |
| `migrations/0019_send_files.sql`                              | `d59ba11466f324a6664e03f775f37c100d2147cbfacee51a366b4367dc749ec9` |
| `migrations/0020_personal_api_keys.sql`                       | `7b70b5c2284509990bc223991e5f5fcd09868027f0a5fae6ed17464d2618eb14` |
| `migrations/0021_emergency_access.sql`                        | `7fc2730ee3c2ff63c99bc27f27dcedfc16482813a66e6852fef38540848853d5` |
| `migrations/0022_user_key_id.sql`                             | `608dfed8ec4c1e845a4704f0a0f0bf60390eae92bdf8812f897834058f984597` |
| `migrations/0023_device_session_binding.sql`                  | `cbfeb4757dbc657ad60c275993eac56c1819637e641a8c4bc4e1330ba36cf55d` |
| `migrations/0024_organization_invitations.sql`                | `a80018a1ad21d0155b65f158239281b57cebdea69b473412f6d02fa8e6d02c77` |
| `migrations/0025_organization_groups.sql`                     | `77c435c557ed416962e84ed8d8afaa331f9e643bc0740cade340d2a7518730ff` |
| `migrations/0026_organization_policies.sql`                   | `2167c4100e6b1df28faf056c94348e102b4194a763ad526474bca8879693e8c6` |
| `migrations/0027_session_mfa_assurance.sql`                   | `645e6ebcb8dfa1d9ad865a5e42dc0e8321e4bf9c9d5bf4c57bdeef9ff3491ec2` |
| `migrations/0028_organization_audit_scope_index.sql`          | `02f5c6b141b23c170843787bc114053caec9b505c288206e5132bc832a41c45f` |
| `migrations/0029_organization_membership_mutation_marker.sql` | `bb7878e639689caba48825b914e0db21d8f8b83810a0037e0a4fb7f98b853b88` |
| `migrations/0030_organization_policy_mutation_marker.sql`     | `b353368af866d30d546f83188dc5cf5642b56047de1a8a2161b09a91d2ee7858` |
| `migrations/0031_email_verification.sql`                      | `0875c85363623e89329499fbcf7fd7e3b3907c51015a2f76b68adfcd6b6a358a` |
| `migrations/0032_company_settings.sql`                        | `86560684688c3332de0685fe703b5faacb012365573f7e43b658279dbf645338` |
| `migrations/0033_initial_setup.sql`                           | `43e83312712f1c28582f526fcfa45dfaddc87f845a5f44c925d9f4d0e2a6a93c` |

Migration 0022 is a post-release, local-only source addition for nullable user-key
ID metadata and old-writer invalidation. It has not been applied remotely. The
column must precede new application code and be retained on application rollback;
see [user-key ID operations](../operations/user-key-id.md).

Migration 0023 is a post-release, local-only source addition that binds device
access and refresh tokens to an immutable login session. It has not been applied
remotely. Apply its additive columns before the session-aware application; legacy
sessions require a fresh login. Keep the columns on rollback and preserve the
revocation check in any recovery build. See [device session operations](../operations/device-sessions.md).

Migration 0024 is a post-release, local-only source addition for hashed,
recipient-bound organization invitations and expiry. It has not been applied
remotely. Membership routes stay default-off in tracked configuration and need
a separately configured invitation delivery service and private signing secret.
Keep its additive columns on application rollback. See [organization membership
operations](../operations/organization-membership.md).

Migrations 0025–0030 are post-release source additions for same-organization
group grants, required TOTP policy metadata, current-family MFA evidence,
indexed event-time audit scope, and internal membership and policy mutation nonces.
They have not been applied remotely. All six precede this company source even
when management flags are false: authentication, shared access, sync, and
lifecycle statements reference the schema independently of route gates.
Keep additive schema and committed policy, group, audit, and session state on
recovery. Do not use an older build that ignores those authorization conditions.
See [company administration](../operations/company-administration.md).

Migration 0031 is a post-release, local-only source addition for the experimental
EVP relying-party challenge store. It has not been applied remotely. Apply all
tracked migrations through 0031 before deploying this source. The default-off
`HONOWARDEN_EMAIL_VERIFICATION_ENABLED` route guard returns `501` before
challenge-table or network work; it does not replace schema-first rollout. Tracked RP origin
and reviewed issuer registry remain empty. The table binds a nonce digest to
the authenticated account email, security stamp, current refresh family, device,
audience, and expiry. It stores neither the raw nonce nor a signed proof.
Consumption, email verification metadata, account revision, and required audit
commit in one batch. Keep the additive table and committed account state on
application rollback; do not unconsume a challenge or reconstruct a proof.
Local source and synthetic tests do not establish actual browser/issuer
interoperability or authorize remote migration or activation.
See [ADR 0017](../adr/0017-email-verification-protocol.md) and
[email verification operations](../operations/email-verification.md).

## Required Tables At Freeze

Migration 0033 adds a durable singleton first-account setup receipt. Apply it
before enabling `HONOWARDEN_INITIAL_SETUP_ENABLED`; every tracked profile defaults
to false. It has not been applied remotely. Retain the receipt on account deletion,
application rollback and backup/restore so first-account setup cannot reopen.
See [initial setup](../operations/initial-setup.md).

Migration 0032 adds dashboard company metadata behind the default-off
`HONOWARDEN_COMPANY_SETTINGS_ENABLED` flag. It has not been applied remotely.
Apply it before activation and retain the populated table on application
rollback. The existing audit table also stores required test-mail cooldown
claims; no inbox-delivery assertion is stored. See
[company settings](../operations/company-settings.md).

- `schema_migrations`
- `initial_setup_receipt`
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
- `legacy_inquiry_messages_0009`
- `auth_requests`
- `user_totp`
- `totp_challenges`
- `organizations`
- `organization_company_settings`
- `organization_users`
- `organization_groups`
- `organization_group_users`
- `collection_groups`
- `organization_policies`
- `collections`
- `collection_users`
- `collection_ciphers`
- `account_kdf_population`
- `user_key_rotation_wrapper_history`
- `account_lifecycle_tokens`
- `email_verification_challenges`
- `account_deletions`
- `sends`
- `webauthn_credentials`
- `webauthn_challenges`
- `personal_api_keys`
- `emergency_access`

## Policy

- Migration hashes are checked by `test/release-docs.test.ts`.
- Editing a frozen migration requires explicit release-manager approval and a
  new backup/restore drill.
- Adding a migration requires updating this document, `docs/current-state.md`,
  and the release notes.
