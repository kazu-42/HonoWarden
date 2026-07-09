# Release Readiness Index

Target: `v0.1.0-alpha`.

Last updated: 2026-07-08.

Use this index as the feature-freeze entry point:

- [Feature Freeze Checklist](feature-freeze-checklist.md)
- [Fresh Deploy Guide](fresh-deploy-guide.md)
- [Upgrade Guide](upgrade-guide.md)
- [Rollback Guide](rollback-guide.md)
- [Migration Freeze](migration-freeze.md)
- [Release Gate Preflight](release-gate-preflight.md)
- [Alpha Tagging Runbook](tagging-runbook.md)
- [Publication Gate](publication-gate.md)
- [Live Client Evidence](live-client-evidence.md)
- [Backup Restore Drill Evidence](backup-restore-drill-evidence.md)
- [Staging Deploy Dry Run Evidence](staging-deploy-evidence.md)
- [Cloudflare Resource Evidence](cloudflare-resource-evidence.md)
- [Worker Live Smoke Evidence](worker-live-smoke-evidence.md)
- [Website Live Evidence](website-live-evidence.md)
- [Email Routing Evidence](email-routing-evidence.md)
- [Retention Cron Evidence](retention-cron-evidence.md)
- [Operations Rollback Evidence](ops-rollback-evidence.md)
- [Secret Rotation Drill Evidence](secret-rotation-drill-evidence.md)
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
