# Week 26 Worker Live Smoke Evidence

## Goal

Record the approved alpha GitHub Release publication and API Worker live-smoke
operation without overstating website, email, or rollback readiness.

## Success Criteria

- Published prerelease readback is recorded for `v0.1.0-alpha`.
- Staging and production API Workers are deployed from the release target commit.
- Live HTTPS smoke evidence is recorded for health, database health, config, and
  synthetic denied prelogin behavior.
- Production D1 migration application is recorded without secrets or user data.
- Candidate previous-version handles are recorded, while approved rollback
  commands remain unresolved until a verified safe target is selected.
- `pnpm ops:readiness:packet` advances past Worker live-smoke evidence and
  reports the next real blocker.

## Current Context

The release tag `v0.1.0-alpha` targets
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`. The GitHub Release has been
published and verified. A first Worker deploy was accidentally run from `main`
`392637b3e277ba35057ba461cd82fac69013f603`, then corrected by checking out the
release target commit and redeploying staging and production before smoke was
recorded.

## Constraints

- Do not write secrets to the repository or terminal output.
- Do not enable public registration.
- Do not claim website, custom-domain API, Email Routing, or rollback readiness
  from API Worker smoke alone.
- Keep the external brand compatibility target out of code identifiers and
  tracked product text.

## Risks

- Deploying from the wrong commit could make the live service differ from the
  published alpha artifact.
- A recorded rollback command that points to the wrong previous version can slow
  incident recovery.
- Marking rollback evidence `passed` without rehearsal would overstate
  operational readiness.
- Health endpoints prove service availability, not end-to-end real client
  compatibility with real secrets.

## Approval Required

Standing operator approval was provided on 2026-07-08 for scoped release,
deploy, DNS/email, and evidence work without repeated confirmations. Secret
writes, credential disclosure, and destructive rollback execution still require
the same non-secret evidence discipline.

## Work Packets

- `01-release-publication`: record the published prerelease verification.
- `02-worker-deploy-smoke`: record Worker deploy source, IDs, live smoke, and
  production migration evidence.
- `03-readiness-and-rollback`: update rollback/readiness docs and verify the
  next ops blocker.
- `04-verification`: run formatting, brand scan, readiness packet, workflow
  verification, review, PR, CI, and merge readback.

## Integration Policy

Accept evidence only when the command, target commit, environment, and
non-secret output can be reconciled. Preserve partial status for rollback until
a verified safe target is selected and rollback is exercised or separately
rehearsed.

## Verification

- `pnpm release:published:packet -- --strict`
- `pnpm release:status:packet -- --strict`
- `pnpm release:completion:audit -- --strict`
- `curl` live smoke against staging and production Worker URLs
- `pnpm ops:readiness:packet`
- `pnpm format`
- `pnpm brand:scan`
- `git diff --check`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-worker-live-smoke-evidence`

## Reusable Artifacts

The release evidence files and this workflow directory become the reusable
checklist for future release-to-Worker deploy evidence collection.
