# Organizations & Shared Vault — Design

Single design doc (requirements + design + decisions) for the team-vault product
line adopted in [ADR 0010](../../adr/0010-organizations-team-vault-product-line.md).
Grounded in the pinned official client contract (`dist-chrome-2026.6.1` source maps).

## 1. Goal & non-partial rule

Let official clients create an organization, define collections, share personal
ciphers into them, invite/confirm members with encrypted key distribution, and
sync — with **cross-user isolation proven** and the **server never seeing org
plaintext**. Every not-yet-implemented sub-surface returns a typed error, never
silent partial behavior (ADR 0005's core warning).

## 2. Upstream contract (authoritative facts)

Wire casing: responses are read first-char-insensitively but we **emit PascalCase**
to match existing `compat/fixtures`. Requests arrive camelCase.

### Endpoints (slice-ordered)

| Slice | Method            | Path                                                                       | Request                                                             | Response                                                           |
| ----- | ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1     | POST              | `/api/organizations`                                                       | `OrganizationCreateRequest`                                         | `OrganizationResponse`                                             |
| 1     | GET               | `/api/sync` (extend)                                                       | –                                                                   | org in `Profile.Organizations[]`, `Collections[]`, org `Ciphers[]` |
| 1     | GET               | `/api/organizations/{id}`                                                  | –                                                                   | `OrganizationResponse`                                             |
| 2     | GET               | `/api/organizations/{id}/collections`                                      | –                                                                   | `ListResponse<CollectionResponse>`                                 |
| 2     | GET               | `/api/collections`                                                         | –                                                                   | `ListResponse<CollectionResponse>` (assigned)                      |
| 2     | POST              | `/api/organizations/{id}/collections`                                      | `CreateCollectionRequest`                                           | `CollectionAccessDetailsResponse`                                  |
| 2     | PUT               | `/api/organizations/{id}/collections/{cid}`                                | `UpdateCollectionRequest`                                           | `CollectionAccessDetailsResponse`                                  |
| 2     | DELETE            | `/api/organizations/{id}/collections/{cid}` (+ bulk `DELETE /collections`) | `CollectionBulkDeleteRequest`                                       | –                                                                  |
| 3     | POST              | `/api/ciphers/create`                                                      | `CipherCreateRequest` `{cipher, collectionIds}`                     | `CipherResponse`                                                   |
| 3     | PUT               | `/api/ciphers/{id}/share`                                                  | `CipherShareRequest` `{cipher(+organizationId,key), collectionIds}` | `CipherResponse`                                                   |
| 3     | PUT               | `/api/ciphers/{id}/collections_v2`                                         | `CipherCollectionsRequest` `{collectionIds}`                        | `OptionalCipherResponse`                                           |
| 3     | PUT               | `/api/ciphers/share` (bulk)                                                | `CipherBulkShareRequest`                                            | `ListResponse<CipherResponse>`                                     |
| 4     | GET               | `/api/organizations/{id}/users?includeGroups&includeCollections`           | –                                                                   | `ListResponse<OrganizationUserUserDetailsResponse>`                |
| 4     | POST              | `/api/organizations/{id}/users/invite`                                     | `{emails[], type, collections[], permissions}`                      | –                                                                  |
| 4     | POST              | `/api/organizations/{id}/users/{uid}/accept`                               | `{token}`                                                           | –                                                                  |
| 4     | POST              | `/api/organizations/{id}/users/{uid}/confirm`                              | `{key}`                                                             | –                                                                  |
| 4     | POST              | `/api/organizations/{id}/users/public-keys`                                | `{ids[]}`                                                           | `ListResponse<...PublicKey>`                                       |
| 4     | PUT/DELETE/revoke | `/api/organizations/{id}/users/{uid}[...]`                                 | role/remove                                                         | –                                                                  |

Gotchas: move-to-collection is `collections_v2` (not `/collections`); `share`
requires the source cipher to have **no** `organizationId`; the create response
body is not used for vault state (client `fullSync`s immediately) — so the org,
its `Key`, and default collection must appear in the next `/api/sync`.

### Required response fields (PascalCase)

- **`Profile.Organizations[]`**: `Id, Name, Key` (org key RSA-encrypted to _this_
  user — without it the client throws during sync decryption), `Status:2`
  (Confirmed), `Type` (0 Owner/1 Admin/2 User/4 Custom), `Enabled:true`,
  `Permissions:{}`, `UsePasswordManager:true`, `UseTotp`. All other `Use*`/limit/
  provider fields may be `false/0/null`.
- **`Collections[]`** (inside sync): `"object":"collectionDetails"`, `Id`,
  `OrganizationId`, `Name` (org-key-encrypted), `ReadOnly:false`,
  `HidePasswords:false`, `Manage:true`, `Type:0`.
- **org `Ciphers[]`**: `OrganizationId`, `CollectionIds[]`, `Key` (cipher key
  wrapped by org key), `Edit:true`, `ViewPassword` (omit → treated true).
- **List envelope**: `{object:"list", data:[...], continuationToken:null}`.

### `OrganizationCreateRequest` (load-bearing)

`{ name, billingEmail, planType(Free=0), key (org key → creator pubkey),
keys:{publicKey, encryptedPrivateKey}, collectionName (org-key-encrypted) }`.
Constructor throws if `key`/`keys`/`collectionName` missing.

## 3. Data model (migration `0014_organizations.sql`)

```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- plaintext
  billing_email TEXT,
  plan_type INTEGER NOT NULL DEFAULT 0,
  public_key TEXT,                       -- org RSA public key
  private_key TEXT,                      -- org RSA private key, AES under org key (opaque)
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  use_totp INTEGER NOT NULL DEFAULT 1 CHECK (use_totp IN (0,1)),
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_users (
  id TEXT PRIMARY KEY,                   -- OrganizationUserId
  organization_id TEXT NOT NULL,
  user_id TEXT,                          -- null until accepted
  email TEXT NOT NULL,
  org_key TEXT,                          -- org key RSA-encrypted to THIS member (opaque); null pre-confirm
  status INTEGER NOT NULL DEFAULT 0,     -- Invited0 Accepted1 Confirmed2 Revoked-1
  type INTEGER NOT NULL DEFAULT 2,       -- Owner0 Admin1 User2 Custom4
  permissions TEXT,                      -- JSON PermissionsApi (custom only)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (organization_id, email)
);
CREATE INDEX idx_org_users_user ON organization_users(user_id, status);
CREATE INDEX idx_org_users_org ON organization_users(organization_id, status);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  encrypted_name TEXT NOT NULL,          -- org-key-encrypted (opaque)
  external_id TEXT,
  type INTEGER NOT NULL DEFAULT 0,
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX idx_collections_org ON collections(organization_id);

CREATE TABLE collection_users (
  collection_id TEXT NOT NULL,
  organization_user_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  hide_passwords INTEGER NOT NULL DEFAULT 0,
  manage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, organization_user_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_user_id) REFERENCES organization_users(id) ON DELETE CASCADE
);

CREATE TABLE collection_ciphers (
  collection_id TEXT NOT NULL,
  cipher_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, cipher_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);

-- ciphers: additive org ownership (personal rows keep organization_id = NULL)
ALTER TABLE ciphers ADD COLUMN organization_id TEXT
  REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ciphers ADD COLUMN cipher_key TEXT;      -- per-cipher key wrapped by org key
CREATE INDEX idx_ciphers_org ON ciphers(organization_id);
```

`ciphers.user_id` stays NOT NULL (the creator/sharer, for provenance). Access is
no longer derived from `user_id` alone for org rows — see §4.

## 4. Access-control model change (the crux)

Personal ciphers keep `WHERE user_id = ?`. Org ciphers add an authorization path:

> A caller may read a cipher iff it is **personal and owned by them**
> (`organization_id IS NULL AND user_id = caller`) **or** it is **org-owned and the
> caller is a confirmed member with access to a collection containing it**
> (`organization_id = O AND EXISTS confirmed membership in O with collection access
to the cipher`).

Write/edit adds the collection `manage`/`readOnly` and role checks. Concretely a
reusable `resolveCipherAccess(db, callerUserId, cipherId)` returns
`{ found, canRead, canEdit, canDelete, organizationId }`, and every cipher route
(`GET/PUT/DELETE /api/ciphers/:id`, attachments, bulk) consults it instead of the
bare owner predicate. Sync unions personal ciphers with org ciphers reachable via
confirmed membership + collection access.

**Slice 1 simplification**: a freshly created org has exactly one confirmed member
(the creator/owner) with `manage` on the default collection, so org-cipher access
reduces to "creator owns the org." Multi-member `collection_users` gating lands in
slice 4. The `resolveCipherAccess` seam is built in slice 1 so later slices only
widen the membership set, never rewrite call sites.

## 5. Key / crypto model (server = opaque router)

The server generates and inspects **none** of these; it stores and returns them:

- org `key` per member = org symmetric key RSA-OAEP to that member's `users.public_key`.
- org `keys.encryptedPrivateKey` = org RSA private key, AES under the org key.
- collection `encrypted_name`, cipher `cipher_key` and `encrypted_json` = AES under org key.
- confirm `key` = org key RSA-OAEP to the confirmed member's public key.

**Invariant**: each confirmed member's `/api/sync` `Profile.Organizations[].Key`
is _their own_ `organization_users.org_key`. The server must never substitute,
combine, or derive these. No endpoint returns another member's wrapped key except
`users/public-keys` (public keys only) for the inviter to wrap the org key.

## 6. Sync & profile projection

Extend `buildSyncResponse` / `buildSyncProfileResponse` (src/app.ts ~4361/4370):

- `Profile.Organizations[]` ← confirmed memberships (`status=2`) for the caller,
  each carrying that member's `org_key` as `Key`.
- top-level `Collections[]` ← collections in the caller's confirmed orgs they can
  access, `object:"collectionDetails"`.
- `Ciphers[]` ← union of personal + accessible org ciphers, org rows carrying
  `OrganizationId/CollectionIds/Key`.
  `GET /api/accounts/profile` reuses the same org projection (already emits empty
  arrays in the fixture).

## 7. Implementation slices (each: TDD, gates, live-client fixture, PR)

1. **Org foundation**: migration; `POST /api/organizations` (persist org + keys +
   auto default collection + creator confirmed-owner membership); `GET
/api/organizations/{id}`; sync/profile emit the org + default collection;
   `resolveCipherAccess` seam. Fixture: create-org + sync shows org & collection.
2. **Collections CRUD**: `GET/POST/PUT/DELETE` org collections + `GET /api/collections`;
   `CollectionAccessDetailsResponse`. Owner-only manage in this slice.
3. **Cipher sharing**: `PUT /ciphers/{id}/share` (reject if already org-owned),
   `POST /ciphers/create` with collectionIds, `collections_v2`, bulk share; org
   ciphers appear in sync with `Key/CollectionIds`. Attachment `share` deferred.
4. **Membership**: invite → accept → confirm (`users/public-keys`, per-member key
   distribution), roles, revoke/remove, disabled-member sync exclusion; widen
   `resolveCipherAccess` to `collection_users`. Cross-user isolation test matrix.
5. **Audit + policy default + export**: audit events for membership/role/collection/
   assignment; org-aware no-policy default; org metadata in account export;
   documented rollback.

## 8. Cross-user isolation tests (ADR 0005 gate — required each slice)

For every org read/write path assert BOTH allowed and denied:

- non-member cannot read/list/sync an org's ciphers, collections, or org profile.
- revoked/invited/accepted (non-confirmed) member is excluded from sync + denied.
- read-only collection member cannot edit/delete; no-access member cannot read a
  cipher even in the same org.
- a personal cipher of user A is never returned to org member B via any org path.
- share never leaks A's personal cipher into an org A doesn't own/confirm in.
- the server never returns member B's wrapped `org_key` to member A.

## 9. Migration, rollback, export

- Migration is purely additive; existing personal rows get `organization_id NULL`
  and behave exactly as today (regression-tested).
- Per-slice rollback = `git revert` + redeploy; no destructive down-migration.
  Dropping org tables (if ever) is a separate, data-loss-acknowledged operation.
- Account export (slice 5) includes org metadata the exporting member can decrypt;
  it never exports other members' wrapped keys.
