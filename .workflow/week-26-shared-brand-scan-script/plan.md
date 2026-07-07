# Week 26 shared brand scan script

## Goal

Centralize the repository external-brand scan in a shared package script so
normal CI, release tag verification, and local verification use the same policy
implementation.

## Success Criteria

- `pnpm brand:scan` runs a Node standard-library scanner.
- Main CI and release tag verification both call `pnpm brand:scan`.
- Focused tests prove clean content passes and constructed blocked content
  fails without storing the blocked provider-brand token contiguously.
- Workflow tests assert both workflows retain the `Repository brand scan` step
  and call the shared package script.
- Local checks, workflow verification, read-only release audits, and GitHub
  Actions CI pass.

## Current Context

- Main CI and release-tag workflow both enforce repository brand scan, but each
  currently embeds scan logic in workflow YAML.
- The release remains draft-publication approval gated.

## Constraints

- Do not add the forbidden external compatibility-provider brand word as a
  contiguous tracked string.
- Do not publish releases, move tags, deploy, mutate DNS/email/Cloudflare
  resources, or touch secrets.
- Spark implements only the bounded tooling patch; main agent owns QA.

## Risks

- A scanner that diverges from the previous workflow exclusions could introduce
  false positives or false negatives.
- A focused test could accidentally store the blocked word contiguously; brand
  scan must catch this before commit.

## Approval Required

No approval required for local tooling, tests, docs, workflow artifact,
commit/push, and CI readback. Release publication remains separately
approval-gated.

## Work Packets

1. Spark implementation packet
   - Own scan script, package script, workflow call sites, and focused ops tests.
2. Main integration and evidence packet
   - Own docs/current-state and `.workflow/week-26-shared-brand-scan-script/**`.
   - Review, verify, commit, push, and record CI evidence.

## Integration Policy

Review scanner exclusions and ensure the scanner itself does not contain the
blocked provider-brand token contiguously. Keep workflow steps named
`Repository brand scan`.

## Verification

- Focused brand scan and workflow tests.
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

- `.workflow/week-26-shared-brand-scan-script`
