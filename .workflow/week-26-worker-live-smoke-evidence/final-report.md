# Final Report: Week 26 Worker Live Smoke Evidence

## Outcome

In progress. The GitHub prerelease was published and verified, and the staging
and production API Workers were redeployed from the alpha release target commit
with passing live smoke. Local validation, ops readiness readback, and local
review passed. The workflow is not complete until PR CI and merge readback are
recorded.

## Accepted Results

- Release publication proof for `v0.1.0-alpha`.
- Release-target deploy correction after an initial `main` deploy.
- Staging Worker deployment `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`, version
  `bf0333dc-9efa-4001-aa31-20b3e10731c9`.
- Production Worker deployment `24f81b98-b761-4faa-aa78-cd773bb5d0c1`,
  version `72577dd9-c859-4673-b653-fbdd796f8f7d`.
- Live health, database health, config, and denied synthetic prelogin smoke for
  staging and production.
- Candidate previous-version handles for staging and production, with approved
  rollback commands left unresolved because the previous versions are
  pre-correction `main` deployments.

## Rejected Results

- The earlier deployments from `main`
  `392637b3e277ba35057ba461cd82fac69013f603` are not accepted as alpha deploy
  evidence because they were not built from the release target commit.
- Rollback evidence is not accepted as passed because no verified safe rollback
  target was selected and no rollback was exercised.

## Conflicts Resolved

The release target and live deploy source briefly diverged. The conflict was
resolved by checking out `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`,
redeploying staging and production, then taking smoke evidence from those
deployments.

## Verification Evidence

- `pnpm release:published:packet -- --strict`: passed.
- `pnpm release:status:packet -- --strict`: passed with
  `phase: published_verified`.
- `pnpm release:completion:audit -- --strict`: passed with
  `completion: complete`.
- Staging and production Worker smoke: passed.
- `pnpm ops:readiness:packet`: passed as a read-only command and reported
  `not_ready` with `blockingReason: website_live_evidence_missing`.
- Focused tests, format, typecheck, lint, brand scan, release gate, diff check,
  and workflow verification passed locally.
- `codex review --uncommitted`: passed after the initial rollback-target
  finding was corrected.
- Remaining checks are tracked in `state.json`.

## Remaining Risks

- Website live evidence is still separate.
- Email Routing live evidence is still separate.
- Approved API Worker rollback commands are unresolved, and rollback has not
  been rehearsed or executed.
- The API Workers are currently proven on `workers.dev` URLs, not custom API
  routes.

## Reusable Follow-up

Use this workflow as the template for future publish-and-deploy evidence: verify
the release target first, deploy that exact source, record live smoke, keep
candidate previous versions separate from verified rollback targets, then run
ops readiness to expose the next blocker.
