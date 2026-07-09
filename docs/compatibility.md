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

## Web Vault Boundary

HonoWarden does not expose a Web Vault compatibility surface in the alpha
release. The compatibility matrix tracks protocol clients only. A future Web
Vault would require a new ADR, a dedicated compatibility row, browser security
review, CSP and static-asset provenance rules, deployment/rollback separation,
and live evidence before any support claim.

## Send And Public Sharing Boundary

HonoWarden does not expose Send or public file-sharing in the alpha release.
Cipher-scoped attachments remain authenticated and owner-scoped. Public sharing
would add unauthenticated access, link enumeration risk, expiration, revocation,
rate limiting, abuse reporting, cache policy, and separate retention/deletion
semantics. ADR 0003 defines the minimum design gates before any support claim.

## Emergency Access Boundary

HonoWarden does not expose Emergency Access in the alpha release. Delegated
recovery would add grantee identity proofing, delayed access, cancellation,
notification delivery, cryptographic handoff, abuse controls, and transition
auditing requirements. ADR 0004 defines the minimum design gates before any
support claim.

## Explicit Unsupported Responses

The alpha API returns typed `501` JSON errors for feature families that are
intentionally outside the initial scope:

- `/api/organizations`
- `/api/organizations/*`
- `/api/sends`
- `/api/sends/*`
- `/api/emergency-access`
- `/api/emergency-access/*`

Response shape:

```json
{
  "error": {
    "code": "unsupported_feature",
    "message": "This feature is intentionally not implemented in the alpha scope."
  },
  "requestId": "request-id"
}
```

This project is independent and not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.
