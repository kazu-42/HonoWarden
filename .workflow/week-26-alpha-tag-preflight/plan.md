# Week 26 Alpha Tag Preflight

## Goal

Add a local, read-only preflight for the `v0.1.0-alpha` Git tag so the final
operator step is explicit and auditable without creating or pushing a tag.

## Success Criteria

- `pnpm release:tag:preflight` prints a JSON readiness report.
- Strict mode exits non-zero when any tag-readiness check fails.
- The report includes the target tag, target version, source commit, checks,
  explicit limitations, and tag commands.
- The preflight checks package version, strict release gate status, working tree
  cleanliness, and local tag absence.
- The script never creates a tag, pushes a tag, deploys, or publishes.
- Tests, release docs, current-state docs, format, release gate, and brand scan
  pass.

## Current Context

- Repository-local release gate strict currently reports ready.
- `package.json` and runtime metadata now target `0.1.0-alpha`.
- `git tag --list 'v0.1.0-alpha*'` returned no local tag.
- Creating or pushing the tag is an external release operation and remains
  approval-gated.

## Constraints

- Do not create or push `v0.1.0-alpha` in this slice.
- Do not publish a GitHub release.
- Do not deploy.
- Do not introduce external compatibility brand names.
- Keep the script read-only and deterministic against local repository state.

## Risks

- A dirty working tree could cause the operator to tag uncommitted state.
- A pre-existing local tag could hide an accidental retagging attempt.
- Running release gate and tag commands as a single step would make rollback and
  review harder.
- Verifying only local state does not prove remote tag absence.

## Approval Required

No approval required for local script, tests, docs, and workflow evidence.
Approval is required before creating or pushing the tag or publishing a release.

## Work Packets

- Contract and tests: define the report shape and failure behavior.
- Script implementation: implement read-only checks and command output.
- Docs and scripts: expose the npm script and document its role.
- Verification: run focused and broad checks, brand scan, and workflow verifier.

## Integration Policy

This is release-operations tooling only. It must not change runtime API behavior,
database schema, auth behavior, or deployment configuration.

## Verification

- focused tag preflight tests
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:tag:preflight -- --allow-dirty --allow-existing-tag`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this workflow as the local tag-readiness checklist for future release cuts.
