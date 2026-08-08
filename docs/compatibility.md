# Compatibility Plan

HonoWarden aims for the smallest useful upstream-compatible API surface for personal and small-team vault sync.

## Initial Scope

- API-only server for official upstream clients
- no browser-delivered vault UI
- self-hosted endpoint configuration
- account login and token refresh flows required by official clients
- personal vault sync for encrypted ciphers, folders, collections needed by small-team use, and attachments where required
- D1-backed metadata and encrypted vault records
- R2-backed larger encrypted objects

## Explicitly Out of Scope Initially

- Web Vault
- hosted web app static assets
- browser session or cookie-authenticated vault UI
- public registration
- Organizations administration
- Send
- Emergency Access
- SSO
- multi-tenant hosted operation
- enterprise policy management

## Compatibility Rules

- Prefer behavior observed from official clients over broad feature parity.
- Preserve end-to-end encryption boundaries; the server must not need plaintext vault secrets.
- Keep unsupported surfaces explicit with typed errors instead of silent partial behavior.
- Add compatibility tests before implementing each API surface.
- Keep executable JSON fixtures for client-facing response shapes under `compat/fixtures`.
- Treat fixture regressions as compatibility regressions once a route has been implemented.

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
release. The compatibility matrix tracks protocol clients only. A future Web
Vault would require a new ADR, a dedicated compatibility row, browser security
review, CSP and static-asset provenance rules, deployment/rollback separation,
and live evidence before any support claim.

## Organizations And Shared Vault Product Line

[ADR 0010](adr/0010-organizations-team-vault-product-line.md) supersedes ADR 0005's
organization non-goal for an incrementally verified team-vault product line.
The merged organization foundation provides authenticated organization
create/get plus confirmed-member organization and collection projection in sync
and profile responses. Owner-administered organization collection CRUD is also
implemented with existence-obscuring authorization failures and bounded access
selection.

These source slices are not a broad compatibility claim. Membership and role
lifecycle, invitations, organization cipher sharing and assignment, policy
enforcement, complete cross-user isolation evidence, audit, export/rollback,
and official-client verification advance only through their own bounded slices.
Routes outside the merged slices remain explicit typed unsupported responses.

## Policy Management Boundary

HonoWarden exposes authenticated empty policy metadata reads only. It does not
implement policy mutation or organization policy enforcement in the current
team-vault slices. [ADR 0006](adr/0006-policy-management-scope.md)
defines the no-policy default behavior and the schema, enforcement, audit,
rollback, and compatibility gates required before future policy support.

## Collection Mutation Boundary

Current main implements confirmed-member organization collection reads and
owner-administered organization collection CRUD, including bounded create,
update, single/bulk delete, details, and owner-only access-selection reads.
[ADR 0010](adr/0010-organizations-team-vault-product-line.md) supersedes ADR 0007's original
empty collection boundary for those merged routes. Organization cipher
assignment, non-owner membership selection, membership lifecycle, audit, and
broad official-client compatibility remain unimplemented or unverified.

## Send And Public Sharing Boundary

HonoWarden does not expose Send or public file-sharing in the alpha release.
Cipher-scoped attachments remain authenticated and owner-scoped. Public sharing
would add unauthenticated access, link enumeration risk, expiration, revocation,
rate limiting, abuse reporting, cache policy, and separate retention/deletion
semantics. [ADR 0003](adr/0003-send-public-sharing-scope.md) defines the
minimum design gates before any support claim.

## Emergency Access Boundary

HonoWarden does not expose Emergency Access in the alpha release. Delegated
recovery would add grantee identity proofing, delayed access, cancellation,
notification delivery, cryptographic handoff, abuse controls, and transition
auditing requirements. [ADR 0004](adr/0004-emergency-access-scope.md) defines
the minimum design gates before any support claim.

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

Other typed alpha-scope guards, including unimplemented organization cipher and
membership routes, keep the same HTTP status and structural code but may omit
the top-level client compatibility message.

This project is independent and not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.
