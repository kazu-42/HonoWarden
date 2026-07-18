# HON-208 WebAuthn contract and RP origin policy

## Goal

Define the reviewable protocol and trust contract that every HON-162 WebAuthn
child must follow, and add a default-off runtime policy parser that cannot infer
RP ID or accepted origins from request-controlled headers.

## Success Criteria

- Record the pinned client/server wire, state, PRF, recovery, and compatibility
  contract without claiming that HonoWarden implements WebAuthn yet.
- Adopt an explicit RP ID and exact origin allowlist with deterministic,
  non-secret configuration errors.
- Keep WebAuthn disabled by default in development, staging, and production.
- Permit insecure HTTP only for exact localhost origins and only behind a
  separate explicit opt-in.
- Reject malformed, wildcard, cross-RP, extension/custom-scheme, credentialed,
  path-bearing, query-bearing, fragment-bearing, and insecure origins.
- Document threats, failure behavior, rollout boundaries, and recovery
  invariants for HON-209 through HON-214.
- Pass focused tests, full repository gates, workflow verification, and an
  independent security/compatibility review.

## Current Context

- Main baseline is `30c361fd4c7bcdd01fab47be77037adec31226a5`.
- HON-208 is the only unblocked HON-162 child and is In Progress in Linear.
- No WebAuthn dependency, migration, repository, route, binding, compatibility
  claim, live credential, or runtime activation currently exists.
- Existing public-origin and CORS helpers accept request/header and browser
  extension inputs; those helpers are not a valid WebAuthn trust boundary.
- Pinned client `web-v2026.6.1` and server `v2026.6.1` findings are recorded in
  the completed HON-162 workflow and are authoritative for this child.

## Constraints

- This child owns contract and fail-closed policy only. HON-209 owns schema,
  verifier dependency, challenge persistence, and atomic consumption.
- Do not add WebAuthn routes, migrations, dependencies, feature advertisement,
  or runtime activation.
- Do not derive policy from `Host`, `Origin`, `Forwarded`, or
  `X-Forwarded-*`; all accepted values come from operator configuration.
- Keep tracked configuration free of real custom-domain or production origin
  values. RP ID and origin values are non-secret but environment-specific.
- Keep source capability, configured readiness, deployed activation, and live
  authenticator compatibility as separate claims.

## Risks

- A permissive suffix check can accept attacker-controlled sibling domains.
- URL normalization can accidentally accept credentials, paths, or non-HTTPS
  values that WebAuthn should reject before ceremony verification.
- Treating signature authentication as Vault unlock can strand users because
  the pinned client's PRF-derived key material remains client-side.
- Enabling a flag without complete RP/origin configuration can create a partial
  outage or broaden trust unexpectedly.
- Error messages that echo configuration can leak internal hostnames or other
  operator data into logs or API responses.

## Approval Required

- Granted: local source/docs/tests/workflow edits, worktrees, and normal Linear
  writes with exact readback.
- Separate explicit approval: commit, push, PR/comment/merge, dependency
  publication, deploy, bindings or secrets, DNS/routing, real user or
  authenticator mutation, destructive actions, paid services, external contact.

## Work Packets

- `01-contract`: consolidate pinned wire/state/recovery semantics and child
  ownership boundaries into a repository specification and ADR.
- `02-policy-tdd`: implement the deterministic default-off RP/origin policy
  parser from failing tests.
- `03-config-docs`: add bindings, tracked fail-closed defaults, operator docs,
  and a dedicated threat model without adding runtime routes.
- `04-independent-review`: review policy and documents for trust-boundary,
  compatibility, leakage, and scope regressions; integrate accepted findings.

## Integration Policy

- Tests define accepted syntax; the ADR/spec define why. Any mismatch is a
  failing integration result, not an undocumented parser exception.
- Use structured URL parsing and exact hostname-label comparison. Do not use
  substring or regex-only URL validation.
- Return stable error codes in deterministic order and never echo raw config.
- Reject review suggestions that pull HON-209+ implementation into this child
  or advertise unsupported capability.

## Verification

- Focused domain/config/docs tests, first observed red and then green.
- `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm brand:scan`.
- `git diff --check` and workflow artifact verification.
- Independent source review of security, compatibility, and issue-scope
  invariants before the Linear source-ready checkpoint.

## Reusable Artifacts

The runtime parser and contract documents are the single policy input for
HON-209 through HON-214. Later children must extend the ADR rather than create a
second request-derived or route-local RP/origin policy.
