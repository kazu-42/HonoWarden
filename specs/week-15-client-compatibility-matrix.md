# Spec: Week 15 Client Compatibility Matrix

## Summary

Week 15 introduces a structured compatibility matrix for exact upstream client versions. The matrix records browser extension, desktop, mobile, and CLI release versions, known issues, and current verification level.

## Inputs

- official upstream release metadata checked on 2026-07-06
- `compat/client-matrix.json`
- `docs/compatibility-matrix.md`
- `pnpm compat:test`

## Outputs

- Machine-readable matrix with exact versions for:
  - browser extension
  - desktop
  - mobile Android
  - mobile iOS
  - CLI
- Human-readable matrix with known issues and verification level.
- CI validation that fails when a required surface is missing, a version is not exact, known issues are empty, or common covered flows are not listed.

## Behavior

1. Matrix rows start at `fixture_only` unless live client evidence exists.
2. Matrix rows must include exact version and release timestamp.
3. Mobile rows must include build numbers.
4. Known issues must be explicit and non-empty.
5. The matrix must not claim live client compatibility without captured evidence.

## Edge Cases

- Web app compatibility is out of scope for this matrix because the project is API-only.
- Live client verification can be added later without weakening fixture validation.
- Release source URLs are intentionally not stored in tracked docs to keep external brand strings out of the repository.

## Acceptance Criteria

- [x] Browser extension, desktop, mobile, and CLI rows have exact versions.
- [x] Mobile Android and iOS rows have exact build numbers.
- [x] Every row has known issues and `fixture_only` verification level.
- [x] `pnpm compat:test` validates the matrix.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
