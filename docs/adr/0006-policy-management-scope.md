# ADR 0006: Policy Management Scope

## Status

Accepted

## Context

Organization policy management is inseparable from the organization model it
enforces. A policy engine needs a source of authority for organization
membership, role, collection access, managed-device state, recovery behavior,
and default handling when a user belongs to no organization. Without that model,
policy mutation routes would either do nothing or silently create expectations
that the server cannot enforce.

The alpha personal-vault product line intentionally keeps Organizations and
shared vaults out of scope through ADR 0005. Current client compatibility only
requires policy metadata reads to be present and empty for a personal vault.

## Decision

Do not implement organization policy mutation or enforcement in the alpha
personal-vault product line. Keep policy metadata reads as authenticated,
read-only empty list responses:

- `GET /api/policies`
- `GET /api/policies/new`
- `Policies: []` and `PoliciesNew: []` in sync responses

The default behavior when no organization policy applies is no server-side
organization policy enforcement. Personal-vault auth, TOTP, device, folder,
cipher, attachment, export, and account lifecycle controls remain enforced by
their existing route-specific checks, not by a policy engine.

If organization policies are reconsidered with a shared/team vault product, the
new design must define:

- policy schema, versioning, and migration ownership;
- enforcement points for login, TOTP, device trust, sync, export, cipher
  mutation, attachment access, and collection assignment;
- conflict behavior when multiple policies apply;
- defaults for users with no organization or no matching policy;
- audit events and rollback behavior for policy mutation and enforcement;
- compatibility fixtures for read, mutation, enforcement, disabled policy, and
  rollback paths.

## Consequences

- Alpha users cannot create, update, delete, or enforce organization policies.
- Official-client policy metadata reads remain compatible by returning empty
  list responses for personal-vault accounts.
- Future policy work depends on reopening the organization/shared-vault scope
  decision first.
