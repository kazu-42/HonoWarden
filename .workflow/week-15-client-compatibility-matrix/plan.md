# Week 15 Client Compatibility Matrix

## Goal

Create a conservative client compatibility matrix with exact tracked upstream client versions and CI validation.

## Success Criteria

- Browser extension, desktop, mobile Android, mobile iOS, and CLI rows exist.
- Each row has an exact version, release tag, release timestamp, known issues, and verification level.
- Mobile rows include exact build numbers.
- Matrix rows remain `fixture_only` until live client evidence exists.
- `pnpm compat:test` fails if required matrix fields are missing or too vague.
- Full local checks and CI pass.

## Current Context

- Week 14 completed explicit device revoke behavior.
- Existing compatibility fixtures cover prelogin, token, refresh, and empty sync shapes.
- No tracked client compatibility matrix exists yet.

## Constraints

- Keep external brand strings out of tracked files.
- Do not claim live client verification without captured request/response evidence.
- Do not store source URLs that would violate repository brand-string policy.
- Do not store secrets, token values, real vault data, or personal client data.

## Risks

- A matrix can look like compatibility proof even when it is only fixture evidence.
- Release versions drift; this slice must record the check timestamp and source kind.
- Known issues must remain explicit or future readers will over-trust the matrix.

## Approval Required

No extra approval is required for local docs, tests, git push, and CI under the sustained repo-development request. Ask before live client account setup, real secrets, deploys, destructive git, billing, or production data.

## Work Packets

- `01-release-metadata`: collect exact upstream client release versions for required surfaces.
- `02-matrix-artifacts`: add machine-readable and human-readable compatibility matrix artifacts.
- `03-matrix-validation`: add CI validation for required rows, exact versions, known issues, and covered flows.
- `04-verification`: run local gates, brand scan, workflow verification, push, and CI.

## Integration Policy

Do not ship if the matrix claims live compatibility without evidence, omits a required surface, stores direct external brand strings, or leaves known issues empty.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification
- GitHub Actions CI

## Reusable Artifacts

- `compat/client-matrix.json`
- `docs/compatibility-matrix.md`
- `.workflow/week-15-client-compatibility-matrix/`
