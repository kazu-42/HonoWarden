# Week 26 Prelogin Fixture Replay

## Goal

Extend compatibility fixture route replay to include deterministic prelogin
fixtures, so the first client discovery request is validated against the actual
Hono route in addition to static JSON.

## Success Criteria

- `prelogin/pbkdf2.json` replays successfully through `src/app.ts`.
- Stateless fixture classification allows GET fixtures and explicitly
  allowlisted non-mutating prelogin POST routes.
- Mutating fixtures remain refused by default.
- Documentation distinguishes stateless prelogin replay from stateful token and
  mutation replay.
- Local verification passes for targeted compat tests, workflow artifact,
  typecheck, lint, full test suite, format, release status packet, release gate,
  and repository brand scan.

## Current Context

- Route replay currently covers deterministic GET fixtures.
- `prelogin/pbkdf2.json` is a deterministic POST fixture that does not require
  server-side state mutation.
- `HONOWARDEN_ALLOWED_EMAILS` can make prelogin deterministic in the replay
  environment.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not replay password grant, refresh grant, TOTP login, revoke, or vault
  mutation fixtures in this slice.

## Risks

- Treating every POST as stateless would hide real state sequencing
  requirements. Mitigation: allowlist only the known non-mutating prelogin
  paths.
- Broadening replay wording could imply live compatibility promotion.
  Mitigation: docs keep replay as local synthetic evidence only.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-stateless-classification`: Extend replay helper classification for
  deterministic prelogin routes.
- `02-tests-docs`: Add prelogin fixture replay coverage and update
  documentation.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only explicit non-mutating prelogin POST replay. Reject broad POST
stateless classification, token grant replay, mutating fixture replay, and live
compatibility promotion.

## Verification

- `pnpm compat:test`
- `pnpm exec vitest run test/compat/compat-fixtures.test.ts test/compat/fixture-route-replay.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

The stateless fixture classification can support future deterministic
non-mutating compatibility probes if they are explicitly allowlisted.
