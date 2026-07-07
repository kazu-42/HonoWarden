# Week 26 Unsupported Mutation Guards

## Goal

Close additional alpha-out-of-scope API mutation surfaces with explicit
unsupported responses so clients and operators do not confuse generic 404s with
partially implemented behavior.

## Success Criteria

- Collection, emergency-access, attachment, cipher-attachment, and device
  metadata/trust/key mutation paths return the existing alpha unsupported JSON
  contract.
- Existing supported device, cipher, sync, and folder routes remain unchanged.
- Route tests prove the unsupported surfaces preserve `X-Request-Id` and do not
  fall through to generic `404`.
- Current-state documentation records both the guard and the still-unimplemented
  functionality.
- Local verification passes for the touched tests, workflow artifact, typecheck,
  lint, full test suite, format check, release gate, release status packet, and
  repository brand scan.

## Current Context

- `v0.1.0-alpha` tag verification has passed and the GitHub Release exists as a
  draft prerelease targeting `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`.
- Publication remains separately approval-gated.
- The app already returns explicit `501` responses for organization and public
  sharing surfaces.
- `docs/current-state.md` still lists device mutation and trust/key update APIs
  as not implemented.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Keep the implementation fail-closed; unsupported routes should not touch D1 or
  R2.

## Risks

- Over-broad route patterns could intercept supported routes. Mitigation: use
  exact unsupported paths and keep existing route tests.
- Returning `501` before auth reveals only unsupported status. This matches the
  existing alpha unsupported-surface policy and avoids database access.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-route-guards`: Add explicit unsupported guards for scoped-out mutation
  surfaces.
- `02-tests-docs`: Cover the new guards and update current-state documentation.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only narrowly scoped changes that preserve existing supported route
contracts. Reject new partial functionality for attachment, collection,
emergency-access, or device trust/key surfaces in this slice.

## Verification

- `pnpm exec vitest run test/app.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

The unsupported-surface route list in `test/app.test.ts` is the reusable
regression matrix for future alpha surface hardening.
