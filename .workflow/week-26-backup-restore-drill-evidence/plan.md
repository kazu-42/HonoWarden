# Week 26 Backup Restore Drill Evidence

## Goal

Record real local synthetic backup/restore drill evidence for the alpha release
gate.

## Success Criteria

- Local D1 migrations are applied to the source local database.
- Backup export executes and writes a checksum-bearing manifest.
- Restore executes into a separate local persistence target.
- Restored schema verification succeeds.
- Release evidence document exists and is checked by `pnpm release:gate`.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

The release gate preflight reported backup/restore drill evidence as a blocker.
This slice resolves that blocker with local synthetic evidence only. Remote
Cloudflare evidence remains out of scope.

## Constraints

- Do not touch remote Cloudflare resources.
- Do not store backup artifacts in git.
- Do not use real secrets or real vault data.
- Do not imply production restore readiness.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- Local synthetic evidence can be mistaken for remote production-like evidence.
- Empty R2 object lists do not prove object restore behavior.
- A placeholder evidence file could accidentally unblock the release gate.

## Approval Required

No approval is required for local D1/R2 drill artifacts, docs, tests, git push,
and CI. Remote Cloudflare resource mutation requires a separate gate.

## Work Packets

- `01-local-drill`: Apply local migrations, run backup export, run restore into
  a separate local persistence target, and verify restored tables.
- `02-evidence-doc`: Record evidence and harden preflight evidence checks.
- `03-verification`: Run local gates, brand scans, workflow verifier, and CI.

## Integration Policy

The backup evidence may reduce the release gate blocker count, but must not
mark the alpha as ready while live-client, staging deploy, and Cloudflare
resource evidence remain missing.

## Verification

- `pnpm release:gate`
- `pnpm test -- test/ops/release-gate.test.ts test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
