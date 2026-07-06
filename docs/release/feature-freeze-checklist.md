# Feature Freeze Checklist

Target: `v0.1.0-alpha`.

Last updated: 2026-07-06.

## Freeze Rules

- No new API surface unless it fixes an alpha-blocking defect.
- No migration edits unless the migration freeze document is updated in the same
  change and CI passes.
- No feature promotion beyond `fixture_only` without live client evidence.
- No production audit logging until retention and access rules are approved.
- No real vault data, real passwords, API keys, private keys, seed phrases, or
  recovery codes in tests, dogfood, docs, issues, or Linear.

## Required Local Gates

```sh
pnpm audit --audit-level low
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-25-feature-freeze
```

Run the repository brand scan before release. Both the content scan and path
scan must produce no hits outside explicitly excluded generated/vendor files.

## Required Review

- [Security Review Index](../security/review-index.md)
- [Compatibility Matrix](../compatibility-matrix.md)
- [Backup And Restore Runbook](../operations/backup-restore.md)
- [Dogfood Runbook](../dogfood-runbook.md)
- [Current State](../current-state.md)

## Release Hold Conditions

- any failing CI step
- stale migration freeze hashes
- dependency audit with untriaged production risk
- missing rollback decision for the target deploy
- live-client evidence accidentally containing secrets or real personal data
- unreviewed changes to auth, token, backup, TOTP, or owner-scope behavior
