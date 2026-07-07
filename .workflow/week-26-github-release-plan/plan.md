# Week 26 GitHub Release Plan

## Goal

Add a read-only GitHub release planning command for `v0.1.0-alpha`.

## Success Criteria

- `pnpm release:github:plan` prints JSON with release readiness checks and the
  draft release command.
- The command validates package version and release note sections.
- The command checks local tag context and optionally remote tag context without
  mutating GitHub.
- The output includes `gh release create ... --draft --prerelease --verify-tag`
  but does not execute it.
- Tests, docs, release gate, format, brand scan, and workflow verifier pass.

## Current Context

- Tag creation and push remain approval-gated.
- `gh release create --help` confirms `--draft`, `--prerelease`, `--target`,
  `--verify-tag`, and `--notes-file` support locally.
- Release notes already exist under `docs/release`.

## Constraints

- Do not create, update, publish, or delete a GitHub release.
- Do not create or push a Git tag.
- Do not upload release assets.
- Keep the script read-only and explicit about limitations.
- Do not introduce external compatibility brand names.

## Risks

- A release command without `--verify-tag` could create a tag implicitly.
- Publishing instead of draft creation would make the release visible before
  verification.
- Running release planning before the tag exists needs an explicit allowance so
  it cannot be mistaken for final post-tag readiness.

## Approval Required

No approval required for local code, tests, and docs. Approval is required
before creating or publishing any GitHub release, uploading assets, creating or
pushing tags, or deploying.

## Work Packets

- Tests: define the release plan JSON and strict failure behavior.
- Script: implement read-only release planning.
- Docs: update runbook, release notes, and current state.
- Verification: run focused and broad checks.

## Integration Policy

This is release tooling only. It must not change runtime API behavior, storage,
deployment config, or GitHub release state.

## Verification

- focused GitHub release plan tests
- `pnpm release:github:plan -- --allow-missing-tag --allow-missing-remote-tag --check-remote`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use the release planning command after future tag verification workflows pass
and before any GitHub release draft is created.
