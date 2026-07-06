# Week 24 Security Review Materials

## Goal

Create repository-grounded security review materials for alpha readiness.

## Success Criteria

- Threat model, data flow, auth state machine, secrets inventory, known
  limitations, and review index exist under `docs/security/`.
- Security docs are checked in CI for presence and critical sections.
- Dependency audit evidence is recorded.
- Docs explicitly preserve pre-alpha and no-independent-audit warnings.
- Local gates, brand scans, workflow verifier, and CI pass.

## Current Context

Week 23 added user-isolation regression evidence. Week 24 roadmap requires
security review materials before feature freeze.

## Constraints

- Do not claim an independent security audit.
- Do not use real secrets or production data.
- Do not mutate Cloudflare, Linear, or production resources.
- Do not introduce direct external provider brand strings in tracked files.

## Risks

- Security docs can drift from implementation unless CI verifies required
  sections.
- Overstating readiness would create operational risk.
- Dependency audit results can change over time and must be re-run before
  release.

## Approval Required

No approval is required for local docs, tests, git push, and CI. External
security reviews or production control changes require a separate gate.

## Work Packets

- `01-security-docs`: Add threat model, data flow, auth state machine, secrets
  inventory, known limitations, and index.
- `02-docs-ci`: Add tests that keep security docs present and materially
  populated.
- `03-verification`: Run audit, local gates, brand scans, workflow verifier, and
  CI.

## Integration Policy

Document current controls and residual risks without changing runtime behavior in
this slice.

## Verification

- `pnpm audit --audit-level low`
- `pnpm test -- test/security-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier
- GitHub Actions CI
