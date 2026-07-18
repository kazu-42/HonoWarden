# Orchestration: HON-162 passkey lifecycle decomposition

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Treat the pinned source commits and current HonoWarden source as authoritative.
- Keep WebAuthn login credentials distinct from client-side vault-key passkeys.
- Keep source capability, runtime activation, and live compatibility evidence as
  separate states.
- Require exact Linear body/edge/readback evidence for managed writes.

## Branching Rules

- If browser and native clients use different origins or option endpoints, split
  transport/origin policy from credential persistence rather than weakening RP
  validation globally.
- If the official protocol depends on a commercial or hosted-only service, keep
  it explicitly unsupported and create a decision child instead of a stub.
- If sign counters are zero for backup-eligible multi-device credentials, record
  that state and risk; never manufacture a monotonically increasing value.
- If a mutation can remove the final recovery path, require recent proof and an
  explicit last-method policy before accepting the child.
- If a child cannot be reviewed and rolled back independently, split it again.

## Packet Prompts

### 01-current-auth-boundary

Inventory current routes, repositories, migrations, config/profile fields,
tokens, devices, security stamps, TOTP challenges, audit, retention, quotas, and
tests that constrain WebAuthn integration. Identify reusable primitives and
missing boundaries with file/line evidence.

### 02-pinned-client-contract

At the pinned client commit, map WebAuthn login and credential management service
calls, request/response fields, option parsing, origin/RP assumptions, browser vs
native paths, feature flags, and any separate vault-encryption passkey feature.
Return source paths and behavioral requirements only.

### 03-pinned-server-security-contract

At the pinned server commit, map controllers, entities, persistence, challenge
lifecycle, origin/RP validation, credential counters/flags/transports, token and
session effects, errors, and cleanup. Flag hosted dependencies or assumptions
that HonoWarden must translate.

### 04-linear-decomposition

Integrate the three inventories into bounded children with canonical markers,
acceptance criteria, rollback/evidence requirements, and a cycle-free directed
`blocks` graph. Apply only after local validation, then independently read back
every issue/relation invariant.

## Completion Audit

This workflow is complete only when the pinned contract and current gap map are
reviewed, HON-162 has exact one-PR children and relations in Linear, the first
unblocked implementation child is identified, and no runtime support claim or
external mutation occurred.
