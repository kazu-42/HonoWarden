# Week 26 Device Fixture Coverage

## Goal

Add compatibility fixture and route replay coverage for implemented device
metadata reads and known-device preflight.

## Success Criteria

- Fixture manifest includes deterministic device read and known-device
  preflight flows.
- Client matrix `coveredFlows` includes the new fixture-backed flows.
- Static fixture validation supports scalar boolean response assertions through
  root path `$`.
- Route replay executes the new device fixtures against the Hono app.
- Current-state and compatibility matrix docs describe the added fixture
  coverage without promoting live client evidence.
- Local verification passes for targeted compat tests, workflow artifact,
  typecheck, lint, full test suite, format, release status packet, release gate,
  and repository brand scan.

## Current Context

- `GET /api/devices`, `GET /api/devices/identifier/:identifier`, and
  `GET /api/devices/knowndevice` are already implemented and HTTP-tested.
- Compatibility fixture flow coverage currently records device revoke but not
  read-only device metadata or known-device preflight.
- Known-device preflight returns a scalar boolean, while fixture assertion paths
  currently address object/array children.

## Constraints

- Do not publish the GitHub Release, mutate tags, deploy, change DNS/email, or
  touch secrets.
- Do not add external compatibility brand identifiers to repo-controlled code or
  docs.
- Do not implement device metadata mutation, trust, or key update APIs.
- Keep fixtures synthetic and non-secret.

## Risks

- A scalar fixture assertion could weaken existing JSON path expectations.
  Mitigation: support only exact root path `$` in addition to existing child
  paths.
- Device read fixture coverage could be mistaken for device mutation support.
  Mitigation: docs and matrix known issues keep mutation unsupported.

## Approval Required

No external approval is required for local code, tests, docs, workflow
artifacts, commit, push, and CI verification. Publication and deployment remain
separate approval gates.

## Work Packets

- `01-fixtures`: Add device list, device identifier, and known-device fixture
  JSON.
- `02-tests-manifest-docs`: Add flow manifest and matrix coverage, root JSON
  assertion support, route replay seed coverage, and docs.
- `03-verification`: Run local checks and capture CI evidence after push.

## Integration Policy

Accept only fixture/test/docs changes for already-implemented read/preflight
device routes. Reject any device mutation API behavior or live compatibility
promotion.

## Verification

- `pnpm compat:test`
- `pnpm exec vitest run test/compat/compat-fixtures.test.ts test/compat/fixture-route-replay.test.ts test/compat/client-matrix.test.ts`
- workflow verifier
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- repository brand scan

## Reusable Artifacts

Root JSON fixture assertions enable future scalar compatibility responses
without wrapping them in artificial objects.
