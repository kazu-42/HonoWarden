# ADR 0010: Organizations And Shared Vault — Team-Vault Product Line

## Status

Accepted (supersedes the non-goal in ADR 0005 for a new product line)

## Context

ADR 0005 made Organizations and shared vaults a permanent non-goal for the
**alpha personal-vault product line**, and required that any future shared/team
vault support "start as a new scope decision rather than a route-by-route
expansion." This ADR is that new scope decision.

The product direction has changed: HonoWarden will implement the full
upstream-compatible feature set, of which Organizations and shared vaults are the
foundation (Collections, org policies, and org-scoped ciphers all depend on it).
The upstream contract has been mapped from the pinned official client bundle
(`2026.6.1`) — see [organizations/design.md](../specs/organizations/design.md).

## Decision

Adopt Organizations and shared vaults as a supported **team-vault product line**,
implemented in verified slices, honoring every gate ADR 0005 required:

- organization ownership, membership, role, and invitation lifecycle;
- collection access semantics (read, sync, create, update, delete, cipher assignment);
- cross-user isolation tests for allowed and denied paths;
- encrypted key sharing with a strict server-side plaintext prohibition;
- audit events for membership, role, collection, and cipher-assignment changes;
- policy interaction and no-policy default behavior;
- migration, rollback, and data-export behavior for organization metadata;
- compatibility fixtures for org profile, shared sync, collection assignment,
  removal, and disabled-member flows.

Core invariants:

1. **The server never sees org plaintext.** The organization symmetric key, its
   RSA private key, collection names, and org-owned cipher data are opaque blobs.
   The server stores and routes them; it never decrypts or validates their content.
2. **Access is authorization, not ownership.** A cipher is reachable by its
   personal owner **or** by a confirmed org member with access to a collection the
   cipher belongs to. This replaces the personal-vault `WHERE user_id = ?` model
   with an ownership-or-membership model for org-scoped rows only. Personal ciphers
   keep their existing owner-scoped behavior unchanged.
3. **No partial exposure.** Unimplemented sub-features return typed `501` /
   explicit errors rather than silent partial behavior (ADR 0005's core warning).

## Consequences

- New D1 tables (`organizations`, `organization_users`, `collections`,
  `collection_users`, `collection_ciphers`) and additive `ciphers` columns
  (`organization_id`, `cipher_key`). Personal-vault rows and behavior are unchanged.
- The vault authorization layer gains an org/collection membership check. Every
  cipher read/write path must be re-verified for cross-user isolation.
- `GET /api/sync` and the account profile gain org and collection projections.
- The compatibility matrix may claim org/shared-vault support **only** per slice,
  each backed by live official-client evidence.
- Roll-forward is additive; rollback of a slice is `git revert` + redeploy, with no
  destructive personal-vault migration. Org data rollback is documented per slice.

## Product-line note

Adopting team features raises the operational-security bar (real cross-user
secrets). The security gates in HON-92 (operator 2FA, least-privilege, independent
assessment) become load-bearing before real-secret multi-user production use, not
merely advisory. This ADR covers the feature scope; production real-secret
activation remains separately gated.
