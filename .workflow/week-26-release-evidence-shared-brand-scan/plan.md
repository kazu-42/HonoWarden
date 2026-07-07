# Week 26 release evidence shared brand scan

## Goal

Make the pre-tag release evidence bundle use the shared repository brand scan
script, eliminating duplicate scan traversal and pattern logic from release
tooling.

## Success Criteria

- `scripts/honowarden-release-evidence-bundle.mjs` delegates brand scanning to
  `scripts/honowarden-brand-scan.mjs`.
- Existing evidence shape remains compatible:
  `{ status: "pass" | "fail", detail, matches }`.
- Focused tests pass and prove the bundle still reports a clean brand scan.
- Local checks, workflow verification, read-only release audits, and GitHub
  Actions CI pass.

## Current Context

- `pnpm brand:scan` now exists and is used by main CI and release tag
  verification.
- The release evidence bundle still has independent recursive brand scan logic.
- The alpha release remains draft-publication approval gated.

## Constraints

- Do not add the forbidden external compatibility-provider brand word as a
  contiguous tracked string.
- Do not publish releases, move tags, deploy, mutate DNS/email/Cloudflare
  resources, or touch secrets.
- Spark implements only the bounded release-tooling patch; main agent owns QA.

## Risks

- Changing release evidence bundle scan semantics could break operator approval
  packet expectations.
- Shelling out must distinguish clean pass, policy fail, and scanner execution
  failure with useful diagnostics.

## Approval Required

No approval required for local tooling, tests, docs, workflow artifact,
commit/push, and CI readback. Release publication remains separately
approval-gated.

## Work Packets

1. Spark implementation packet
   - Own `scripts/honowarden-release-evidence-bundle.mjs` and focused test.
2. Main integration and evidence packet
   - Own docs/current-state and `.workflow/week-26-release-evidence-shared-brand-scan/**`.
   - Review, verify, commit, push, and record CI evidence.

## Integration Policy

Keep evidence bundle output compatible with existing tests. Prefer subprocess
reuse of the shared scanner over import because the scanner currently executes
`main()` at module load.

## Verification

- Focused release evidence bundle tests.
- `pnpm brand:scan`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- workflow verifier
- release gate/status/completion audit
- GitHub Actions CI readback

## Reusable Artifacts

- `.workflow/week-26-release-evidence-shared-brand-scan`
