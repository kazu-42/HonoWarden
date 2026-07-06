# Week 5 Bootstrap Account

## Goal

Implement Week 5 account bootstrap as a private operator-only endpoint while keeping public registration disabled and preserving the repository policy that upstream-provider brand strings do not appear in tracked source or docs.

## Success Criteria

- Project-local `/dynamic` command and `codex-dynamic-workflows` skill are available under `.codex/`.
- Bootstrap is default-off and requires both explicit enablement and a bootstrap token.
- Bootstrap account email is normalized and checked against `HONOWARDEN_ALLOWED_EMAILS`.
- Account creation stores only password hash and encrypted key material, not plaintext passwords.
- Duplicate parallel bootstrap attempts resolve through D1 uniqueness and return `409`.
- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, `pnpm format`, and repository brand scan pass.
- Local Workers smoke tests cover disabled/forbidden behavior without secrets.
- CI passes after push.

## Current Context

- Week 1 through Week 4 increments are already pushed and CI-green.
- Current uncommitted work implements Week 5 bootstrap domain, repository, route, tests, docs, and generated Workers types.
- Dev server is running locally on `http://localhost:8787`.

## Constraints

- Do not commit secrets, real bootstrap tokens, real vault data, or plaintext passwords.
- Keep route handlers thin; domain/repository code lives outside `src/app.ts`.
- Keep public registration disabled.
- Keep upstream-provider brand strings out of tracked files.
- Avoid destructive git operations.

## Risks

- Bootstrap endpoint could accidentally behave like public registration.
- Token handling could leak authorization details or allow empty-token bypass.
- D1 duplicate handling must be deterministic under concurrent first-user creation.
- Generated Cloudflare types must stay aligned with `wrangler.jsonc`.

## Approval Required

No extra approval is required for local tests, local workflow artifacts, or normal commits/pushes to the requested repository. Ask before real Cloudflare deploys, creating real D1/R2 resources, setting secrets, or touching production data/accounts.

## Work Packets

- `01-skill-install`: verify `/dynamic` skill installation and command wrapper.
- `02-bootstrap-implementation`: implement domain/repository/route and tests.
- `03-security-review`: inspect default-deny, token, allowlist, storage, and duplicate behavior.
- `04-verification`: run checks, smoke tests, repository scan, workflow verification, and CI.

## Integration Policy

The parent agent integrates all packet results. Accept only findings backed by code, tests, command output, or explicit project policy. Resolve conflicts by inspecting the authoritative source files.

## Verification

- `pnpm cf:typegen`
- `pnpm format`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- repository brand scan
- Local curl smoke tests for bootstrap disabled/forbidden.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-05-bootstrap-account`

## Reusable Artifacts

- `.codex/commands/dynamic.md`
- `.workflow/week-05-bootstrap-account/`
