# Release Readiness Index

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

Use this index as the feature-freeze entry point:

- [Feature Freeze Checklist](feature-freeze-checklist.md)
- [Fresh Deploy Guide](fresh-deploy-guide.md)
- [Upgrade Guide](upgrade-guide.md)
- [Rollback Guide](rollback-guide.md)
- [Migration Freeze](migration-freeze.md)
- [Release Gate Preflight](release-gate-preflight.md)
- [Alpha Tagging Runbook](tagging-runbook.md)
- [Live Client Evidence](live-client-evidence.md)
- [Backup Restore Drill Evidence](backup-restore-drill-evidence.md)
- [Staging Deploy Dry Run Evidence](staging-deploy-evidence.md)
- [Cloudflare Resource Evidence](cloudflare-resource-evidence.md)
- [Alpha Release Notes](v0.1.0-alpha-release-notes.md)

## Freeze Position

The repository-local alpha gate is expected to be ready before tagging, while
the project still carries pre-alpha safety warnings until the tag is created and
reviewed. The feature-freeze materials exist so the final alpha cut can be
reviewed without inventing release process under time pressure.

## Required Evidence Before Tagging

- GitHub Actions CI passes on the release commit.
- Package and runtime metadata report `0.1.0-alpha`.
- Repository brand scan has no content or path hits.
- `pnpm audit --audit-level low` has no unresolved production dependency risk.
- `docs/security/review-index.md` has been reviewed for stale statements.
- `docs/release/migration-freeze.md` matches the migration files on disk.
- Fresh deploy dry-run has been completed against staging configuration.
- Backup export and fresh-target restore drill evidence exists.
- CLI live-client login/sync smoke evidence is recorded; remaining client
  surfaces stay conservative until their own live evidence is recorded.
- `pnpm release:gate -- --strict` passes on the release commit.
- `pnpm release:tag:preflight -- --strict --check-remote` passes on the clean
  release commit before running the printed tag commands.
- [Alpha Tagging Runbook](tagging-runbook.md) has been followed with explicit
  operator approval before tag creation and push.
