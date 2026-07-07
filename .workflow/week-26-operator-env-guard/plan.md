# Week 26 Operator Env Guard

## Goal

Add CI-covered guardrails for the local operator environment used with direnv,
Linear API keys, Cloudflare tokens, and website/email automation.

## Success Criteria

- Tracked `.envrc` contains only non-secret project defaults.
- Local secret files remain ignored by git and are sourced only through ignored
  paths.
- direnv watches local secret files so edits trigger reloads.
- `.env.example` documents required local secret placeholders without values.
- Operator docs mention the environment validation flow.

## Current Context

- `.envrc`, `.env.example`, and `docs/operations/operator-environment.md`
  already exist.
- External writes remain blocked until correct Linear and Cloudflare access is
  available.

## Constraints

- Do not commit real secrets.
- Do not contact Linear, Cloudflare, GitHub, or email providers.
- Keep this as local validation and documentation only.

## Risks

- A tracked `.envrc` with secret exports would leak credentials.
- `.env.local` edits may not reload without explicit direnv watch rules.

## Approval Required

No approval required for local tests/docs/config. External writes remain gated.

## Work Packets

- Test packet: add operator environment policy tests.
- Config packet: update `.envrc` reload behavior if the tests require it.
- Docs packet: record the CI-backed guard in current-state/operator docs.
- Verification packet: run focused and broad checks.

## Integration Policy

Do not change runtime Worker secret handling. direnv remains a local operator
automation convenience only.

## Verification

- `pnpm test -- test/ops/operator-environment.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Reusable Artifacts

Use this pattern for future local-only operator configuration: tracked defaults,
ignored secret files, CI policy tests, and explicit external-write gates.
