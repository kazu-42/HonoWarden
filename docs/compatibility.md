# Compatibility Plan

HonoWarden aims for the smallest useful upstream-compatible API surface for personal and small-team vault sync.

## Current Source Scope

- protocol API for official upstream clients
- limited original company administration source at `/admin`, default-off;
  no upstream Web Vault compatibility claim
- self-hosted endpoint configuration
- account login and token refresh flows required by official clients
- personal vault sync for encrypted ciphers, folders, collections needed by small-team use, and attachments where required
- D1-backed metadata and encrypted vault records
- R2-backed larger encrypted objects

The local company follow-up extends the initial API-only alpha source boundary.
Its administration UI, groups, Type 0 TOTP policy, and audit-query APIs are recorded
as local source capabilities with synthetic tests. This does not establish
Browser/Desktop compatibility, remote activation, or permission to use real secrets.
[ADR 0016](adr/0016-company-administration.md) defines the bounded administration
and current-session MFA implementation contract.

## Remaining Unsupported Or Unverified Scope

- upstream Web Vault and a general browser-delivered personal vault
- cookie-authenticated vault sessions
- public registration
- complete upstream Organizations administration parity
- Send
- Emergency Access
- hosted billing, paid subscriptions, and seat commerce
- commercial licensing and provider/reseller portals
- organization sponsorships
- multi-tenant hosted operation
- enterprise policy types other than the local Type 0 TOTP slice
- SSO, SCIM, directory integration, and enterprise account recovery

## Compatibility Rules

- Prefer behavior observed from official clients over broad feature parity.
- Preserve end-to-end encryption boundaries; the server must not need plaintext vault secrets.
- Keep unsupported surfaces explicit with typed errors instead of silent partial behavior.
- Add compatibility tests before implementing each API surface.
- Keep executable JSON fixtures for client-facing response shapes under `compat/fixtures`.
- Treat fixture regressions as compatibility regressions once a route has been implemented.
- Keep the HON-201 surface inventory in [`compat/route-inventory.json`](../compat/route-inventory.json) classified; `pnpm compat:inventory` fails on unclassified official or HonoWarden surfaces, stale support claims, orphan roadmap entries, and enabled capabilities without evidence. Refreshing official metadata opens a reviewed catalog diff and does not silently change compatibility claims. See [`docs/compatibility-inventory.md`](compatibility-inventory.md).

## Credential Closeout Boundary

Credential operation evidence is reconciled through the canonical
[`credential-evidence.json`](../compat/credential-evidence.json) registry and
[`credential-closeout-packet.json`](../compat/credential-closeout-packet.json)
packet. This credential evidence is separate from fixture compatibility levels:
fixtures prove protocol route shapes, while credential evidence levels describe
how each local credential operation was exercised and read back.

The current credential packet preserves a local-only boundary. It records
`local_api` and `local_official_client` claims against isolated synthetic local
state, with zero `staging` claims and zero `production` claims. It does not
claim official-client settings UI execution, remote account activation, staging
activation, or production activation.

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

## Web Vault Boundary

HonoWarden does not expose a Web Vault compatibility surface in the alpha
release. The local source now includes a limited original company administration
UI for organization creation, invitations, membership and collection grants,
groups, Type 0 policy, and audit history. It uses the authenticated API and bounded
same-origin asset serving; it is separate from an upstream Web Vault implementation.
The admin feature flag remains false in tracked root/staging/production config.
HTTP asset, crypto-client, and UI-state tests do not prove actual browser acceptance.
A general Web Vault still requires a new ADR, a separate compatibility row,
browser security review, CSP and asset provenance, deployment/rollback evidence,
and exact client acceptance.

## Organizations And Shared Vault Product Line

[ADR 0010](adr/0010-organizations-team-vault-product-line.md) supersedes ADR 0005's
organization non-goal for an incrementally verified team-vault product line.
The merged organization foundation provides authenticated organization
create/get plus confirmed-member organization and collection projection in sync
and profile responses. Owner-administered organization collection CRUD is also
implemented with existence-obscuring authorization failures and bounded access
selection.

The local integration source extends that merged foundation with invitation,
recipient acceptance and key confirmation, Owner/Admin/User administration,
direct and group collection grants, revocation/removal, and group CRUD. Organization
cipher create/share and single-item update/trash/restore/permanent-delete enforce
current membership, grants, and applicable TOTP policy. Cross-user isolation and
mutation-time authorization have local API and D1 tests; source presence is not
broad official-client compatibility.

Custom roles, automatic organization-key rotation, organization attachments,
bulk organization cipher lifecycle, and post-share `/collections_v2` reassignment
remain unsupported. Offboarding prevents later authorized server access; it cannot
recall already learned plaintext, keys, or exports. Company client acceptance,
invitation delivery, migration, rollback/restore, deployed activation, and independent
security acceptance remain distinct gates. See the current local classifications
in [the surface inventory](compatibility-inventory.md).

## Policy Management Boundary

[ADR 0006](adr/0006-policy-management-scope.md) records the historical alpha
no-policy scope. Historical personal-vault fixtures retain empty policy metadata reads.
[ADR 0016](adr/0016-company-administration.md) extends that restriction for the
local company slice, which implements Type 0 required-TOTP policy list/read,
impact review, and Owner update with current-family assurance, mandatory atomic
audit, and revision advancement. Other policy types and data-bearing configurations
remain explicit `501` responses; there is no broad enterprise-policy claim.

Management remains default-off. Persisted enabled policies continue to govern
organization access even with management disabled; the flag is not an enforcement
bypass. Authenticated `/api/policies`, `/api/policies/new`, and sync policy fields
project persisted metadata for remediation. Missing/disabled policy imposes no
organization MFA requirement. Authenticated assurance, replay-protected TOTP step-up,
and logout bind proof to the current immutable session family; they are separate
from the management flag and from historical official-client TOTP smoke.

## Collection Mutation Boundary

The source implements confirmed-member organization collection reads and
owner-administered organization collection CRUD, including bounded create,
update, single/bulk delete, details, and owner-only access-selection reads.
[ADR 0010](adr/0010-organizations-team-vault-product-line.md) supersedes ADR 0007's original
empty collection boundary for those merged routes. The local company source now
assigns direct member and group grants through their dedicated APIs. The collection
CRUD request's user selection is still limited to the supported Owner selection;
it is not a general multi-user grants editor. Organization cipher collections are
assigned at creation/share; later `/collections_v2` reassignment remains `501`.
General official-client collection-management acceptance is not established.

## Organization Audit Boundary

Local authenticated `/api/organizations/:id/audit-events` query and CSV export
provide partial committed membership, group, and policy administration history.
The selecting SQL rechecks current organization authorization and applicable TOTP
assurance; signed cursors preserve pagination bounds. CSV exports refuse more than
1,000 rows rather than truncating. This HonoWarden-specific API is not upstream
Events ingestion or full vault activity reporting, and `UseEvents` remains false.
The audit-management flag is default-off; missing cursor-signing configuration
fails with an observable `503`. See [organization audit operations](operations/organization-audit.md).

## Send And Public Sharing Boundary

HonoWarden does not expose Send or public file-sharing in the alpha release.
Cipher-scoped attachments remain authenticated and owner-scoped. ADR 0011 now
defines the accepted future Send product line, dedicated threat model, wire and
storage contract, sliced implementation, activation, evidence, and rollback
gates. That design decision is not source capability or runtime support: all
Send routes and `send_access` still return `501`, and config remains
`send-enabled: false` until the later slices pass environment-specific gates.

## Emergency Access Boundary

HonoWarden does not expose Emergency Access in the alpha release. Delegated
recovery would add grantee identity proofing, delayed access, cancellation,
notification delivery, cryptographic handoff, abuse controls, and transition
auditing requirements. [ADR 0004](adr/0004-emergency-access-scope.md) defined
those minimum design gates. [ADR 0013](adr/0013-emergency-access-product-line.md)
now supplies the accepted future product line, dedicated threat model, and
wire/state contract. That design decision is not source capability or runtime
support: all Emergency Access routes still return `501` until the later slices
pass environment-specific gates.

## Hosted Billing, Licensing, Provider, And Tenancy Boundary

[ADR 0014](adr/0014-hosted-billing-licensing-tenancy.md) separates official-client
startup reads from commercial cloud workflows. The only implemented billing-shaped
route is authenticated `GET /api/account/billing/vnext/subscription`, which
returns a zero-cost canceled cart and cannot imply an active paid subscription,
entitlement, or hosted support contract. Config remains `cloudRegion:
self-hosted`. Profile and sync keep empty `providers` /
`providerOrganizations` and `premiumFromOrganization: false`.

Hosted billing mutations, licenses, plans, provider/reseller portals,
sponsorships, invoices, tax preview, and multi-tenant hosted operation are
rejected. Those families return the same client-readable `501` contract as
other unavailable premium surfaces. A future hosted product would need a new
ADR and security/compliance-gated children before implementation.

## HIBP, Reports, And Integrations Boundary

HonoWarden does not originate breach lookup, password-health reports, security
tasks, a notification center, or vendor event integrations. Official clients
keep local client password-health on the device; `GET /api/hibp/breach` remains
the state-free `501` guard.
[ADR 0015](adr/0015-hibp-reports-integrations-scope.md) inventories
encrypted-metadata report candidates versus plaintext or third-party
disclosure non-goals.

## Explicit Unsupported Responses

The alpha API returns typed `501` JSON errors for feature families that are
intentionally outside the initial scope. Premium-triggered unsupported routes
use a top-level client compatibility message in addition to HonoWarden's stable
structural error code:

- `/api/sends`
- `/api/sends/*`
- `/api/emergency-access`
- `/api/emergency-access/*`
- `GET /api/hibp/breach`
- `POST /identity/connect/token` when `grant_type=send_access`
- `/api/account/billing/vnext/*` except authenticated
  `GET /api/account/billing/vnext/subscription`
- `/api/accounts/subscription`
- `/api/accounts/billing`
- `/api/accounts/billing/*`
- `/api/accounts/license`
- `/api/accounts/cancel`
- `/api/licenses`
- `/api/licenses/*`
- `/api/plans`
- `/api/plans/*`
- `/api/providers`
- `/api/providers/*`
- `/api/organization/sponsorship`
- `/api/organization/sponsorship/*`
- `/api/organizations/:id/billing`
- `/api/organizations/:id/billing/*`
- `/api/organizations/:id/subscription`
- `/api/organizations/:id/license`
- `/api/organizations/licenses`
- `/api/organizations/licenses/*`
- `/api/billing`
- `/api/billing/*`

Response shape:

```json
{
  "Message": "This feature is unavailable on this server.",
  "error": {
    "code": "unsupported_feature",
    "message": "This feature is unavailable on this server."
  },
  "requestId": "request-id"
}
```

Other typed guards, including unsupported group bulk/POST aliases, policy types,
organization attachment/bulk cipher operations, and disabled company management
APIs, keep the same HTTP status and structural code but may omit the top-level
client compatibility message. Disabled `/admin` assets use `404` instead.

This project is independent and not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.
