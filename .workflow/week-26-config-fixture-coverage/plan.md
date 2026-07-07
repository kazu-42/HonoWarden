# Week 26 Config Fixture Coverage

## Goal

Add deterministic compatibility fixture coverage for the anonymous server
configuration endpoint used by current clients before login.

## Success Criteria

- A fixture documents `GET /api/config` with deterministic response assertions.
- The fixture manifest and client coverage matrix include the `config` flow.
- Route replay executes the fixture against the Hono app.
- Compatibility docs and current-state docs describe the coverage.
- Narrow compatibility checks, broad repo checks, release gates, and CI pass.

## Current Context

- CLI live smoke already records `GET /api/config 200`.
- The fixture matrix does not yet include a reusable `config` flow.
- The endpoint is read-only and does not require auth or database state.

## Constraints

- Do not publish or edit the GitHub release.
- Do not create, move, delete, or push tags.
- Do not add external compatibility brand names to repo-controlled files.
- Keep the replay helper unchanged unless the fixture cannot be expressed with
  current conventions.

## Risks

- The response origin is derived from the request URL; route replay with a
  relative fixture path should assert the deterministic replay origin rather
  than the live-client URL.
- JSON path assertions cannot address hyphenated feature-state keys with the
  current fixture helper; avoid weakening essential contract assertions too far.

## Approval Required

None for local fixture/test/docs work. Release publication still requires the
exact approval text emitted by the release status packet.

## Work Packets

- `01-fixture-json`: Spark worker drafts only
  `compat/fixtures/config/server-config-success.json`.
- `02-integration`: main agent updates manifest, matrix, docs, route replay,
  and verification evidence.

## Integration Policy

Accept Spark output only after inspection and route replay. Main agent owns
manifest/test/docs integration and all QA.

## Verification

- Targeted compatibility fixture and route replay tests.
- `pnpm compat:test`
- workflow verifier.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- repository policy external-brand scan.
- `pnpm release:gate -- --strict`
- release status/completion packets.
- GitHub Actions CI after push.

## Reusable Artifacts

This workflow extends the read-only fixture coverage pattern to anonymous
pre-login metadata endpoints.
