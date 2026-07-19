# Result 01: Contract

Status: accepted.

## Outcome

ADR 0012, the pinned wire/state specification, and a dedicated threat model now
freeze the protocol and trust boundaries before any WebAuthn state can be
written. They separate assertion authentication from client-only PRF Vault
unlock and assign every later transition to exactly one HON-209 through HON-214
owner.

## Accepted Decisions

- Preserve the pinned client/server anonymous options, token grant, credential
  management, and PRF key-set wire shapes.
- Treat HonoWarden rename as a documented extension, not pinned compatibility.
- Use explicit operator RP/origin policy only; request, CORS, public-origin, and
  forwarding headers cannot define trust.
- Use seven-minute registration/login and 17-minute PRF key-set windows, atomic
  single-winner consumption, successful-only counter writes, and verified
  backup-state semantics.
- Require recovery-aware deletion and credential-derived session revocation.
- Forbid raw policy, challenge, credential, user-handle, public-key,
  authenticator, signature, PRF, and encrypted-private-key material from logs,
  audit, fixtures, and evidence.
- Keep source capability, runtime activation, live host/authenticator evidence,
  and compatibility promotion as separate states.

## Scope Boundary

HON-208 adds no dependency, migration, repository, route, session method,
feature advertisement, deployment, binding value, credential, or live evidence.
Migration 0015 and all credential/challenge writes remain exclusively HON-209.
