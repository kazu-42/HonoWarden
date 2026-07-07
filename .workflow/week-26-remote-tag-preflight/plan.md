# Week 26 Remote Tag Preflight

## Goal

Add read-only remote tag absence verification to the alpha tag preflight.

## Success Criteria

- `pnpm release:tag:preflight -- --strict --check-remote` includes a
  `remote_tag_absent` check.
- The remote check uses `git ls-remote --tags` and does not mutate the remote.
- Existing local-only preflight behavior remains available when
  `--check-remote` is omitted.
- Release runbook and release docs recommend the remote-checked command before
  tag creation.
- Tests, release gate, format, brand scan, and workflow verifier pass.

## Current Context

- `v0.1.0-alpha` has not been created locally or remotely.
- The previous tag preflight checks package version, release gate, working tree,
  and local tag absence.
- The runbook had a separate manual read-only remote check.

## Constraints

- Do not create a tag.
- Do not push a tag.
- Do not publish a GitHub release.
- Keep remote access read-only.
- Do not introduce external compatibility brand names.

## Risks

- Without an integrated remote check, the operator can accidentally skip remote
  tag absence verification.
- Network-dependent tests would be flaky; tests should use a local temporary
  bare repository for remote-check behavior.
- The normal preflight output should not imply remote verification unless
  `--check-remote` was supplied.

## Approval Required

No approval required for local code, tests, docs, and read-only remote checks.
Approval is required before tag creation, tag push, release publication, remote
tag deletion, or retagging.

## Work Packets

- Tests: add deterministic remote tag absence coverage.
- Script: implement `--check-remote` and `--remote`.
- Docs: update release runbook and release docs to use remote-checked preflight.
- Verification: run focused and broad checks.

## Integration Policy

This is release tooling only. It must not change runtime API behavior, database
schema, deploy configuration, or release tag state.

## Verification

- focused alpha tag preflight test
- focused release docs test
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:tag:preflight -- --strict --check-remote`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use the remote-checked preflight command for future tag approval packets.
