# ADR 0007: Collection Mutation Scope

## Status

Accepted

## Context

Collections are visible in upstream client metadata, but collection mutation and
cipher assignment are shared-vault features rather than personal-vault storage
primitives. Create, update, delete, and assignment behavior require an
organization or team authority, membership checks, role checks, collection
access semantics, cipher ownership rules, audit events, compatibility fixtures,
and migration/rollback handling.

HonoWarden's alpha personal-vault product line keeps Organizations and shared
vaults out of scope through ADR 0005. The current compatibility requirement is
therefore limited to stable collection metadata reads for personal vaults.

## Decision

Keep collection metadata read-only and empty in the alpha personal-vault product
line:

- `GET /api/collections` returns an authenticated empty list.
- `GET /api/collections/:id` returns stable `collection_not_found`.
- `POST`, `PUT`, `PATCH`, and `DELETE` collection routes remain explicit
  unsupported-feature responses.

Do not implement collection create, update, delete, cipher assignment, or
organization-scoped collection behavior until shared/team vault scope is
reopened.

If collection mutation is reconsidered, the new design must define:

- collection ownership and membership authority;
- allowed and denied assignment paths for ciphers and users;
- sync and direct-read behavior for assigned and removed ciphers;
- conflict handling for stale collection and cipher revisions;
- audit events for create, update, delete, assignment, and removal;
- migration, rollback, and export behavior for collection state;
- compatibility fixtures for empty, create, update, delete, assign, unassign,
  denied, and stale-revision flows.

## Consequences

- Alpha users cannot create, edit, delete, or assign collections.
- Personal-vault clients can still read empty collection metadata without
  treating the route as missing.
- Future collection mutation work depends on reopening the shared/team vault
  scope decision first.
