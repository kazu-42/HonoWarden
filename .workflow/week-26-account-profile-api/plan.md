# Week 26 Account Profile API

## Goal

Add a minimal authenticated account profile endpoint that reuses existing account
metadata contracts without adding account mutation or lifecycle behavior.

## Success Criteria

- `GET /api/accounts/profile` requires the same bearer authentication as sync.
- The profile response reuses the same account key metadata, TOTP enabled state,
  organization placeholders, and key-connector defaults as `/api/sync`.
- The response includes master-password unlock metadata using the token response
  `UserDecryptionOptions` shape.
- A compatibility fixture flow records the endpoint contract.
- Current-state docs distinguish this read-only endpoint from still-missing
  profile mutation and account lifecycle flows.
- Local verification passes for touched app and compatibility tests, workflow
  artifact, typecheck, lint, full test suite, format check, release gate,
  release status packet, and repository brand scan.

## Current Context

- `/api/sync` already returns profile metadata and token responses already return
  `UserDecryptionOptions`.
- `GET /api/accounts/revision-date` is implemented and covered by the live CLI
  smoke.
- GitHub Release publication remains separately approval-gated.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not add profile mutation, email change, password change, or account deletion
  behavior in this slice.

## Risks

- Divergence between sync profile and account profile. Mitigation: extract a
  shared profile response builder.
- Overstating compatibility. Mitigation: mark the flow fixture-covered only and
  document that live profile evidence is still missing.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-profile-route`: Add the authenticated read-only route and shared response
  builder.
- `02-compat-docs`: Add HTTP and compatibility fixture coverage, then update
  current-state docs.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only read-only account profile behavior backed by existing user record
fields. Reject any account lifecycle, mutation, or external write behavior.

## Verification

- `pnpm exec vitest run test/app.test.ts test/compat/client-matrix.test.ts test/compat/compat-fixtures.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

`buildProfileResponse` is the shared source for sync and account profile
metadata. The `account_profile` fixture flow is the reusable compatibility
contract.
