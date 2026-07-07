# Week 26 device metadata update API

## Goal

Implement the authenticated device metadata update API for the alpha scope.
The route updates only owner-scoped active device `name` and `type` metadata.

## Success Criteria

- `PUT /api/devices/:id` accepts `name`/`Name` and `type`/`Type`.
- The route requires bearer auth and only updates the authenticated user's
  active device row.
- Missing IDs, invalid payloads, missing devices, cross-user devices, revoked
  devices, and database failures return stable JSON errors.
- Key/trust update routes remain explicit unsupported responses.
- Device update behavior has repository tests, HTTP tests, docs, workflow
  artifact, local verification, commit/push, and CI readback.

## Current Context

- Device list, identifier lookup, known-device preflight, single-device revoke,
  and revoke-all are implemented.
- `PUT/PATCH /api/devices/:id` currently return the alpha unsupported response.
- The database schema already stores device `name`, `type`, and `updated_at`.

## Constraints

- Do not mutate keys, trust state, refresh tokens, tags, releases, deploys,
  DNS/email, Cloudflare resources, Linear, secrets, or production data.
- Keep tracked content free of the external provider brand token.
- Preserve existing route shapes and error response conventions.

## Risks

- Updating a device by identifier instead of stable ID could cross scopes; use
  path ID plus authenticated user ID.
- Changing device identifier would require ID consistency rules; keep it out of
  this slice.
- Trust/key routes have different security semantics; keep them unsupported.

## Approval Required

No approval is required for local code, tests, docs, workflow artifacts,
commit/push, and CI readback. External writes remain separately approval-gated.

## Work Packets

1. Backend TDD implementation
   - repository update operation, HTTP route, and HTTP/repository tests.
2. Docs and compatibility evidence
   - current-state, compatibility matrix, fixtures if useful, workflow state.

## Integration Policy

Accept only changes that keep the route owner-scoped and metadata-only. If a
client sends key/trust fields, ignore them for this route and leave dedicated
key/trust routes unsupported.

## Verification

- Focused repository and app tests.
- Compatibility fixture tests if fixture metadata changes.
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm brand:scan`
- `pnpm test`
- `pnpm compat:test`
- `pnpm release:gate -- --strict`
- GitHub Actions CI readback.

## Reusable Artifacts

- `.workflow/week-26-device-metadata-update-api`
