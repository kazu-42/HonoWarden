# Week 26 Alpha Version Alignment

## Goal

Align repository-local release metadata with the `v0.1.0-alpha` target without
creating the external Git tag.

## Success Criteria

- Package version is `0.1.0-alpha`.
- HTTP health metadata reports `0.1.0-alpha`.
- Server config metadata reports `0.1.0-alpha`.
- Root service metadata exposes the same version while retaining explicit
  pre-alpha safety status until the tag is created.
- Tests, release gate, format, and brand scan pass.

## Current Context

- `pnpm release:gate -- --strict` reports `overall: ready`.
- Release docs target `v0.1.0-alpha`.
- Runtime metadata still reports `0.0.0-alpha`.
- `package.json` still reports `0.0.0`.

## Constraints

- Do not create Git tags in this slice.
- Do not deploy or publish.
- Keep pre-alpha warnings in docs until a release tag is actually cut.
- Do not introduce external compatibility brand names.

## Risks

- Updating runtime version without tests would let package/runtime drift again.
- Changing safety status to production-ready language would overclaim release
  maturity.

## Approval Required

No approval required for local code, tests, and docs. Approval is required before
tagging or publishing.

## Work Packets

- Version source: add a central release version constant.
- Runtime metadata: wire root, health, and config to the constant.
- Tests/docs: update expectations and release docs.
- Verification: run focused and broad checks.

## Integration Policy

This is metadata-only. It must not change API auth, storage, or compatibility
behavior.

## Verification

- focused app metadata tests
- release docs tests
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Reusable Artifacts

Use this workflow as the version-alignment checklist before future tag cuts.
