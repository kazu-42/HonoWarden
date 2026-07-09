# ADR 0005: Organizations And Shared Vault Scope

## Status

Accepted

## Context

Organizations and shared vaults are not just additional metadata rows. They add
cross-user authorization, membership lifecycle, organization ownership, role
transitions, collection assignment, shared key distribution, billing or
administrative boundaries, and audit requirements. A partial implementation
would be more dangerous than an explicit unsupported response because clients
could infer shared access while the server still lacks a complete isolation and
rollback model.

The current HonoWarden product line is an API-only personal-vault server for a
small set of tracked client protocol surfaces. It does not have a hosted admin
console, multi-tenant tenancy model, organization recovery process, external
notification system, or production-grade cross-user dogfood evidence.

## Decision

Treat Organizations and shared vaults as a permanent non-goal for the alpha
personal-vault product line. Keep `/api/organizations` and
`/api/organizations/*` outside the supported compatibility surface and returning
explicit unsupported-feature errors.

If HonoWarden later becomes a shared or team vault product, it must start as a
new scope decision rather than a route-by-route expansion of the personal-vault
surface. That design must define:

- organization ownership, membership, role, and invitation lifecycle;
- collection access semantics for direct reads, sync, create, update, delete,
  and cipher assignment;
- cross-user isolation tests for allowed and denied paths;
- encrypted key sharing and server-side plaintext prohibitions;
- audit events for membership, role, collection, and cipher-assignment changes;
- policy interaction and default behavior when no organization policy applies;
- migration, rollback, and data-export behavior for organization metadata;
- compatibility fixtures for organization profile metadata, shared sync,
  collection assignment, removal, and disabled-member flows.

## Consequences

- Alpha users cannot create organizations, shared vaults, shared collections, or
  organization roles.
- Personal-vault collection metadata remains read-only and empty unless a later
  non-organization feature explicitly changes it.
- Policy enforcement cannot depend on organization state in this product line.
- The compatibility matrix must not claim organization or shared-vault support
  for the alpha release.
