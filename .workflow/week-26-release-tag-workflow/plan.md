# Week 26 Release Tag Workflow

## Goal

Add a read-only GitHub Actions verification workflow for the `v0.1.0-alpha`
tag push event.

## Success Criteria

- `.github/workflows/release-tag.yml` runs on `v0.1.0-alpha` tag pushes.
- The workflow uses read-only repository permissions.
- The workflow runs the same release-critical checks as main CI plus strict
  release gate, tag preflight with existing local tag allowed, and repository
  brand scan.
- Tests assert the workflow exists and does not contain tag creation or push
  commands.
- Release runbook and current-state docs mention tag verification.
- Local tests, release gate, format, brand scan, and workflow verifier pass.

## Current Context

- `main` CI is green for the remote tag preflight commit.
- Actual tag creation and push remain approval-gated.
- The existing main CI only runs on pull requests and main branch pushes.

## Constraints

- Do not create or push `v0.1.0-alpha`.
- Do not publish a GitHub release.
- Do not deploy.
- Do not include blocked external brand names in tracked files.
- Keep workflow permissions read-only.

## Risks

- A tag push without tag-specific CI would rely only on prior main CI evidence.
- Running remote absence checks after tag push would fail by design, so tag CI
  must use local existing-tag allowance instead.
- A brand scan command can accidentally embed the blocked term; assemble the
  pattern from fragments.

## Approval Required

No approval required for local workflow, tests, and docs. Approval is required
before creating or pushing the tag, publishing a release, or deploying.

## Work Packets

- Test contract: assert the tag workflow and non-mutating commands.
- Workflow implementation: add GitHub Actions release tag verification.
- Docs: update runbook and current state.
- Verification: run focused and broad checks.

## Integration Policy

This is CI and release process only. It must not change runtime behavior,
storage, deploy configuration, or tag state.

## Verification

- focused release tag workflow test
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use the workflow pattern for future release tags by updating the tag trigger and
expected package metadata checks.
