# Compatibility Surface Inventory

Last reviewed: 2026-09-02.

HON-201 maintains a machine-checked map from pinned official client and server
surfaces to HonoWarden behavior. The structured sources of truth are:

- [`compat/route-inventory.json`](../compat/route-inventory.json) —
  classifications, owner issues, evidence, and last-review dates
- [`compat/official-surface-catalog.json`](../compat/official-surface-catalog.json) —
  official tagged-source snapshot
- [`scripts/honowarden-route-inventory.mjs`](../scripts/honowarden-route-inventory.mjs) —
  scanner and CI verifier

This inventory extends [`docs/compatibility.md`](compatibility.md) and
[`docs/compatibility-matrix.md`](compatibility-matrix.md). It does not replace
fixture coverage or live-client rows.

## What Is Observed

The scanner extracts:

- Hono routes from `src/app.ts`
- token grants from identity token handling
- config `featureStates` and profile/sync fields
- D1 migrations and ADRs
- ROADMAP explicit non-goals
- tracked Wrangler flags that are `true`
- official controller files, token grants, and material routes from the pinned
  catalog

CI fails on unclassified newly observed surfaces, stale support claims, orphan
roadmap entries, or an enabled capability without evidence.

## Classifications

| Classification | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `implemented`  | HonoWarden exposes the surface. A `supportClaim` is allowed only with evidence. |
| `planned`      | Accepted future work with an owner issue. Not a runtime support claim.          |
| `client_local` | Official client behavior that does not require a HonoWarden route.              |
| `hosted_only`  | Cloud commerce, hosted admin UI, or vendor callbacks outside self-hosting.      |
| `rejected`     | Explicitly out of scope or fail-closed (`403` / `501`).                         |

Requirement kinds separate protocol needs from upstream UI, cloud commerce,
client-local behavior, optional integrations, and operator surfaces.

## Source Pins

Catalog and inventory pins must match the official client harness:

- server `v2026.6.1` @ `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`
- web `web-v2026.6.1` @ `39f07436ca60e3f25eac47777671754f288a98f1`
- browser `browser-v2026.6.1` @ `723c075bf8b9f45c901e56195be8e94e43ed75a2`
- CLI `cli-v2026.6.0` @ `e6293ff2bc85123e9baaa998cf1543030ec5d9f0`

Do not invent official source that cannot be pinned to those tags.

## Refresh Policy

Official metadata refresh is a reviewed diff. `pnpm compat:inventory
refresh-catalog` compares a local official checkout with the checked-in catalog
and fails when controllers changed. It never writes inventory classifications
and does not silently change compatibility claims. Updating those claims still
requires an explicit inventory edit, evidence, and review.

Cadence: every 14 days and before a release candidate, matching the client
matrix metadata policy.

## Send Runtime Boundary

HON-184/185 keep `/api/sends`, `/api/sends/*`, and `grant_type=send_access` on
HTTP `501`. Config `send-enabled` stays `false`. The inventory may record the
Send product line as `planned`; it must not set `supportClaim: true` for those
surfaces.

## Commands

```sh
pnpm compat:inventory
pnpm compat:inventory -- --json
pnpm compat:inventory refresh-catalog
pnpm compat:test
```
