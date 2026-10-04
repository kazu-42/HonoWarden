# Release Readiness Index

Published release: `v0.1.0-alpha`, published as a prerelease on 2026-07-08.

Last updated: 2026-09-22.

This index links historical release evidence and subsequent local work. It does
not authorize retagging, republication, or deployment. At tag time only CLI
`2026.6.0` had sealed `live_smoke` evidence; other tag-time rows were
`fixture_only`. Later browser, desktop, Android, and additional CLI evidence
must be read as post-tag records. Official metadata was refreshed on 2026-09-22:
Browser 2026.9.1 and Desktop/Android/iOS 2026.9.0 remain `fixture_only`.
The later [exact CLI 2026.9.0 local smoke](current-cli-2026-9-smoke.md) passed
isolated synthetic login, populated sync, decryption, lock/unlock, logout, and
repeat login. Only that CLI row is `live_smoke`; this does not establish broad
client regression, staging/production acceptance, or execution authority.

Release and operations references:

- [Feature Freeze Checklist](feature-freeze-checklist.md)
- [Fresh Deploy Guide](fresh-deploy-guide.md)
- [Upgrade Guide](upgrade-guide.md)
- [Rollback Guide](rollback-guide.md)
- [Migration Freeze](migration-freeze.md)
- [Release Gate Preflight](release-gate-preflight.md)
- [Alpha Tagging Runbook](tagging-runbook.md)
- [Publication Gate](publication-gate.md)
- [Live Client Evidence](live-client-evidence.md)
- [Current CLI Local Mutation Acceptance](current-cli-2026-9-local-acceptance.md)
- [Android Mobile Live Client Evidence](android-mobile-live-client-evidence.md)
- [TOTP And Recent-Auth Live Evidence](totp-recent-auth-live-evidence.md)
- [Account Password Change Local Evidence](account-password-change-local-evidence.md)
- [Account KDF Change Local Evidence](account-kdf-change-local-evidence.md)
- [Account Key Initialization Local Evidence](account-key-initialization-local-evidence.md)
- [User-Key Rotation Local Evidence](user-key-rotation-local-evidence.md)
- [Account Lifecycle Local Evidence](account-lifecycle-local-evidence.md)
- [Official Client Credential Harness](../operations/official-client-credential-harness.md)
- [Auth Request Staging Evidence](auth-request-staging-evidence.md)
- [Two-User Dogfood And Disabled-User Evidence](two-user-dogfood-evidence.md)
- [Backup Restore Drill Evidence](backup-restore-drill-evidence.md)
- [Remote Backup Evidence](remote-backup-evidence.md)
- [Staging Deploy Dry Run Evidence](staging-deploy-evidence.md)
- [Cloudflare Resource Evidence](cloudflare-resource-evidence.md)
- [Log Retention Evidence](log-retention-evidence.md)
- [Worker Live Smoke Evidence](worker-live-smoke-evidence.md)
- [Website Live Evidence](website-live-evidence.md)
- [Email Routing Evidence](email-routing-evidence.md)
- [Desktop Notification Transport Evidence](desktop-notification-transport-evidence.md)
- [Login With Device Live Client Evidence](login-with-device-live-client-evidence.md)
- [Retention Cron Evidence](retention-cron-evidence.md)
- [Operations Rollback Evidence](ops-rollback-evidence.md)
- [Secret Rotation Drill Evidence](secret-rotation-drill-evidence.md)
- [Alpha Release Notes](v0.1.0-alpha-release-notes.md)

## Credential Closeout Evidence

Canonical source: [packet](../../compat/credential-closeout-packet.json) and
[registry](../../compat/credential-evidence.json). The packet is the release
index entry for reconciled credential and recovery closeout. The linked
per-operation local evidence files remain supporting detail, not separate
canonical entries. Current canonical counts are:

| Evidence level          | Claims |
| ----------------------- | -----: |
| `fixture`               |      0 |
| `local_api`             |      4 |
| `local_official_client` |      7 |
| `staging`               |      0 |
| `production`            |      0 |

The packet must not be used as proof of tracked staging or approved production
activation.

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

## Historical Freeze Position

The alpha tag already exists. The feature-freeze materials retain the original
release review context. Pre-alpha safety limitations and current operational
readiness must be assessed independently from that historical publication.

## Historical Release Criteria And Post-Tag Evidence

The following checklist is retained as release-process history. Some linked
client evidence was added after publication and is not part of the sealed
tag-time snapshot. These entries are not current instructions to create or move
the published tag. Current client metadata freshness is checked separately by
the release gate; a historical archive pass cannot satisfy that check.

- GitHub Actions CI passes on the release commit.
- Package and runtime metadata report `0.1.0-alpha`.
- Repository brand scan has no content or path hits.
- `pnpm audit --audit-level low` has no unresolved production dependency risk.
- `docs/security/review-index.md` has been reviewed for stale statements.
- `docs/release/migration-freeze.md` matches the migration files on disk.
- Fresh deploy dry-run has been completed against staging configuration.
- Backup export and fresh-target restore drill evidence exists.
- Scheduled remote backup workflow and remote backup evidence are recorded.
- CLI live-client login/sync, one-step TOTP login, and recent-auth lifecycle
  smoke evidence is recorded.
- Android and Desktop live-client login and empty-vault sync smoke evidence is
  recorded; iOS stays conservative until its own live evidence is recorded.
- synthetic two-user dogfood and disabled-user lifecycle evidence is recorded,
  with production lifecycle execution still operator-gated.
- `pnpm release:gate -- --strict` passes on the release commit.
- `pnpm release:tag:preflight -- --strict --check-remote` passes on the clean
  release commit before running the printed tag commands.
- [Alpha Tagging Runbook](tagging-runbook.md) has been followed with explicit
  operator approval before tag creation and push.

## Post-Alpha Operations Readiness

Publishing the GitHub Release is not the same as production operations
readiness. After release publication is verified, use the read-only operations
packet to aggregate the remaining deploy, website, DNS, email, smoke, and
rollback gates:

```sh
pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

The tag workflow arguments can be omitted after the recorded recovery evidence
exists; the packet resolves them from
`.workflow/week-26-release-tag-recovery/state.json` and revalidates the run
before reporting publication readiness.

The packet is intentionally conservative. It treats documentation-only website
status and local email input presence as useful context, but not as live
operational proof. Strict mode is reserved for the state after release
publication, Worker smoke evidence, website domain evidence, Email Routing
evidence, and rollback evidence have all been recorded.

The post-alpha evidence files started as `Status: not_performed` placeholders.
Only mark an evidence file `passed` after the corresponding approved operation
has actually run and the redacted proof is recorded.
