# ADR 0004: Emergency Access Scope

## Status

Superseded by ADR 0013 for the future Emergency Access product line. The
alpha/runtime exclusion remains active until ADR 0013's activation gates pass.

## Context

Emergency Access is a delegated recovery workflow. It is not a normal vault sync
operation because it grants another identity a path to recover or view vault
material after a delay, approval, or timeout. Implementing it safely requires
identity proofing, grantee lifecycle, delay windows, cancellation, notification,
auditability, and a cryptographic handoff model that does not expose vault data
to the server.

The alpha product does not yet have organizations, admin UI, external
notification delivery, or live production lifecycle evidence. Adding Emergency
Access before those controls would create a high-impact privilege escalation
surface.

## Decision

Do not implement Emergency Access in the alpha scope. Keep
`/api/emergency-access` and `/api/emergency-access/*` outside the supported
compatibility surface and returning explicit unsupported-feature errors.

If Emergency Access is reconsidered, implementation must start with a new design
packet or ADR that defines:

- grantor and grantee identity requirements;
- invitation, acceptance, delay, approval, cancellation, timeout, and recovery
  state transitions;
- notification delivery and failure behavior;
- cryptographic handoff boundaries and server-side plaintext prohibitions;
- audit events for every transition without vault payload exposure;
- abuse controls for repeated invitations and recovery attempts;
- rollback and incident response for accidental or malicious grants;
- compatibility fixtures for accepted, denied, canceled, expired, and recovered
  flows.

## Consequences

- Alpha users cannot configure emergency recovery delegates.
- Recovery remains operator-owned account lifecycle work, not an end-user
  feature.
- Emergency Access routes must continue to fail explicitly until the design
  above is implemented and verified.
- The compatibility matrix must not claim Emergency Access support in the alpha
  release.

## Supersession

ADR 0013 supplies the replacement product decision, dedicated threat model,
wire/state contract, sliced implementation order, and activation/rollback gates
required above. This satisfies the design-first prerequisite; it does not
itself implement or activate Emergency Access. ADR 0009's `501` guards remain
the current runtime contract until the later slices produce environment-specific
evidence.
