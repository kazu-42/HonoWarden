# HON-223 Reset Salvage Manifest

Date: 2026-08-07.

Reset base: `origin/main` at
`1fb0aa1dcf6d31795a49d2a6ae447a8a49a8f9a3`.

Stacked dependency prerequisite:
`b18d6f754dc12edb746169c01e19dfdab81cd9b8`. This separate commit patches the
live 2026-08-07 dependency audit without mixing those five files into the
HON-223 closeout diff.

Rejected candidate: `feat/hon-223-review-closeout` at
`386f24f15a5b6b89417badfee4635d8e4dc0e10d`.

Recovery ref: `archive/hon-223-nonconvergent-20260807` at the same rejected
candidate SHA.

## Decision

Do not merge or continue remediating the rejected candidate. Its first commit
expanded credential publication scanning from the eight registered artifacts
to repository-wide Markdown and workflow surfaces. The following 57 commits
then repeatedly extended a bespoke Markdown, HTML, SVG, CSS, JavaScript,
encoding, and Unicode recognizer. That recognizer has no finite completeness
argument, so additional example-based tests do not prove the publication
boundary safe.

HON-223 is a review, publication, and parent-closeout task. The reset keeps that
scope. The existing eight-artifact verifier on `origin/main` remains unchanged
in this lane. Any redesign of that already-merged verifier is independent
security work and must have its own acceptance criteria and PR.

## Live Source Of Truth

The 2026-08-07 read-only Linear query verified:

- HON-223 is `In Progress`, unarchived, with parent HON-207 also `In Progress`.
- The HON-223 description is byte-identical to the source-owned CLOSE-1
  definition: 1,382 bytes, SHA-256
  `11a1d93637c0614751cbaf84c0ffe23e8982f78506be348dd82b8c1fac928d69`.
- HON-219 through HON-223 currently have zero active or archived Linear
  relations between them.
- No Linear mutation was performed during the reset audit.

## File Disposition

### Rebuild From Verified Facts

These files carry closeout state, but must be rebuilt or selectively ported
instead of copied wholesale from the rejected candidate:

- `.workflow/hon-160-account-credential-mutation/final-report.md`
- `.workflow/hon-160-account-credential-mutation/results/hon-160-closeout-start-readback.json`
- `.workflow/hon-160-account-credential-mutation/state.json`
- `.workflow/hon-207-credential-closeout/results/04-compatibility-evidence.md`
- `.workflow/hon-207-credential-closeout/results/04c-docs-index-reconciliation.md`
- `.workflow/hon-207-credential-closeout/results/05-review-closeout.md`
- `.workflow/hon-207-credential-closeout/scripts/hon-207-linear-plan.mjs`
- `.workflow/hon-207-credential-closeout/scripts/hon-207-linear-plan.test.mjs`
- `.workflow/hon-207-credential-closeout/scripts/hon-222-linear-plan.mjs`
- `.workflow/hon-207-credential-closeout/scripts/hon-222-linear-plan.test.mjs`
- `.workflow/hon-207-credential-closeout/scripts/sync-linear-plan.mjs`
- `.workflow/hon-207-credential-closeout/state.json`
- `docs/current-state.md`
- `test/compat/credential-closeout-docs.test.ts`
- `test/ops/hon-223-closeout.test.ts`

The rebuilt closeout result records the reset and only future evidence from the
new branch. The 1,542-line rejected review diary stays recoverable through the
archive ref and is not republished as the new result.

### Revalidate Before Restoring Historical Readbacks

These are generated readbacks. The HON-222 artifact records an immutable
2026-07-28 checkpoint and may be restored only after a fresh query proves its
issue identities, archive timestamps, relation count, and rendered checkpoint
are unchanged. The HON-207 artifact must be regenerated from the current live
state after its source definition is updated:

- `.workflow/hon-207-credential-closeout/results/hon-222-linear-plan-readback.json`
- `.workflow/hon-207-credential-closeout/results/hon-222-linear-plan-readback.md`
- `.workflow/hon-207-credential-closeout/results/linear-plan-readback.json`
- `.workflow/hon-207-credential-closeout/results/linear-plan-readback.md`

### Keep `origin/main` Unchanged In This Lane

These changes were scanner-driven, unrelated wording adjustments, or
historical evidence edits that HON-223 does not need:

- `.workflow/hon-160-account-credential-mutation/orchestration.md`
- `.workflow/hon-160-account-credential-mutation/plan.md`
- `.workflow/hon-160-account-credential-mutation/results/03-test-rollback.md`
- `.workflow/hon-207-credential-closeout/results/01-official-client-harness.md`
- `.workflow/hon-207-credential-closeout/results/04a-evidence-contract.md`
- `.workflow/hon-207-credential-closeout/results/04b-closeout-packet-secret-scan.md`
- `docs/operations/cloudflare-access-control.md`
- `docs/operations/official-browser-profile-evidence.md`
- `docs/operations/official-client-credential-harness.md`
- `docs/operations/operator-environment.md`
- `docs/operations/request-quotas.md`
- `docs/operations/website-email.md`
- `docs/release/android-mobile-live-client-evidence.md`
- `docs/release/auth-request-staging-evidence.md`
- `docs/release/totp-recent-auth-live-evidence.md`
- `docs/specs/organizations/design.md`
- `scripts/honowarden-credential-closeout.mjs`
- `test/compat/credential-closeout.test.ts`

The relation-audit changes are also excluded because fresh readback shows no
managed relations to preserve:

- `.workflow/hon-207-credential-closeout/scripts/hon-207-relation-audit.mjs`
- `.workflow/hon-207-credential-closeout/scripts/hon-207-relation-audit.test.mjs`

### Split Into Independent Security Maintenance

The 2026-08-05 dependency advisory remediation may be valuable, but it is not
HON-223 closeout behavior and may already be stale. Re-run a current audit and
deliver it separately if still required:

- `docs/security/dependency-audit.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `test/security-docs.test.ts`

## Reset Invariants

1. The new branch does not add a repository-wide presentation-language
   scanner.
2. HON-223 changes only source-owned closeout state, generated readbacks, and
   tests for those closeout invariants.
3. Generated files come from fresh read-only Linear data and remain honest
   about external PR, CI, merge, and post-merge gates.
4. No source artifact claims its own exact-head review, GitHub publication,
   merge, or Linear completion.
5. The rejected branch stays recoverable until the reset branch is independently
   reviewed and accepted.
6. No deploy, real credential operation, production mutation, external comment,
   push, PR, or Linear write is authorized by this reset.
7. The dependency prerequisite must merge first; the closeout diff is reviewed
   against that exact commit rather than hiding advisory remediation inside
   HON-223.

## Verification Plan

1. Add focused tests for completed archived packets, CLOSE-1 as the sole active
   child, immutable historical closeout data, and honest external-gate wording.
2. Rebuild the minimal source-owned plan and closeout documents.
3. Regenerate Linear readbacks through the repository verifier.
4. Run focused workflow and closeout tests, then typecheck, lint, formatting,
   compatibility, full tests, dependency audit, and release gate.
5. Obtain one independent exact-head diff review. A finding against unchanged
   `origin/main` becomes a separate tracked security concern; it does not grow
   this closeout branch into a general-purpose parser.
