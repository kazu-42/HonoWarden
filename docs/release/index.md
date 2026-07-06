# Release Readiness Index

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

Use this index as the feature-freeze entry point:

- [Feature Freeze Checklist](feature-freeze-checklist.md)
- [Fresh Deploy Guide](fresh-deploy-guide.md)
- [Upgrade Guide](upgrade-guide.md)
- [Rollback Guide](rollback-guide.md)
- [Migration Freeze](migration-freeze.md)
- [Alpha Release Notes](v0.1.0-alpha-release-notes.md)

## Freeze Position

The current repository state is still pre-alpha. The feature-freeze materials
exist so the final alpha cut can be reviewed without inventing release process
under time pressure.

## Required Evidence Before Tagging

- GitHub Actions CI passes on the release commit.
- Repository brand scan has no content or path hits.
- `pnpm audit --audit-level low` has no unresolved production dependency risk.
- `docs/security/review-index.md` has been reviewed for stale statements.
- `docs/release/migration-freeze.md` matches the migration files on disk.
- Fresh deploy dry-run has been completed against staging configuration.
- Backup export and fresh-target restore drill evidence exists.
- Compatibility matrix remains conservative until live evidence is recorded.
