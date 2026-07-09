# ADR 0003: Send And Public Sharing Scope

## Status

Accepted

## Context

Send and public file-sharing flows are intentionally different from normal
authenticated vault sync. They introduce unauthenticated public access,
share-link enumeration risk, expiration and revocation semantics, download rate
limits, abuse reporting, and retention/deletion requirements for metadata and
objects that can outlive the creating session.

HonoWarden's alpha scope already stores cipher attachments as opaque encrypted
R2 objects bound to authenticated owners and cipher lifecycle. Public sharing
would require a separate threat model because the access path is not owner
authenticated and because request volume can be driven by anyone with a link.

## Decision

Do not implement Send or public file-sharing in the alpha scope. Keep
`/api/sends`, `/api/sends/*`, `/api/attachments`, and `/api/attachments/*`
outside the supported compatibility surface except for the implemented
cipher-scoped attachment routes under `/api/ciphers/:id/attachment`.

If Send or public sharing is reconsidered, implementation must start with a new
design packet or ADR that defines:

- public access token format, entropy, lookup, and enumeration resistance;
- expiration, revocation, maximum access count, and idempotent delete behavior;
- rate limits, abuse reporting, and alerting for anonymous public routes;
- security headers and cache policy for public download responses;
- D1/R2 storage shape, retention, and deletion semantics;
- encrypted/opaque object handling and metadata redaction rules;
- audit events that do not expose vault payloads or public link secrets;
- compatibility fixtures for success, expired, revoked, not found, and
  rate-limited access.

## Consequences

- Alpha users cannot share public text or files through HonoWarden.
- Cipher-scoped attachment upload/download/delete remains authenticated and
  owner-scoped.
- Public sharing routes must continue to fail explicitly until the design above
  is implemented and verified.
- The compatibility matrix must not claim Send or public file-sharing support in
  the alpha release.
