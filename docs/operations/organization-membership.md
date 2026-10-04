# Organization Membership Operator Contract

Status: local source implementation with synthetic test accounts. This document
describes the API and its recovery boundaries; it is not deployment authorization
or proof of company acceptance. The server remains pre-alpha. Use the
[current state](../current-state.md) and [release evidence index](../release/index.md)
for the separate delivery and acceptance status.

## Scope And Runtime Boundary

The supported membership slice is invite → authenticated acceptance → recipient
public-key lookup → confirmation with the recipient's wrapped organization key →
collection assignment → sync → revoke/remove. It is API-only; an organization
management interface and a production invitation delivery service are separate
integration work. Hosted billing, organization groups, custom roles, custom
permissions, and organization-wide `accessAll` grants are outside this slice.

`HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED` remains default-off in the tracked
root, staging, and production Wrangler configuration. Disabled membership routes
return `501 unsupported_feature` before authentication or database access,
including the member/public-key GET and HEAD paths when global request quota is
configured. The
existing organization/collection/shared-cipher foundation is a separate surface;
this flag gates membership management, not all organization data access.

Invite, reinvite, and accept require the dedicated
`HONOWARDEN_ORGANIZATION_INVITE_SECRET`; invite and reinvite also require the
`ORGANIZATION_MEMBERSHIP_MAILER` service binding. Missing configuration fails
loudly with `503 server_misconfigured`, and reports an operation code and request
ID. Keep the secret outside tracked files and provide at least 32 ASCII characters
of strong random material. The domain enforces a minimum of 32 UTF-8 bytes.

The mailer adapter posts to its fixed service-binding destination
`https://organization-membership-mailer.internal/deliver`. Its JSON payload is
`recipientEmail`, `token`, `organizationId`, `membershipId`, and `expiresAt`.
Only an explicit HTTP `202` counts as acceptance by the transport. That response
does not prove receipt by the recipient. The mailer must have its own reviewed
durable delivery, access control, redaction, retention, and failure monitoring
before real invitations are admitted. Do not log the payload or include it in
ordinary request/error traces.

This runbook intentionally supplies no flag activation, secret-setting, migration,
or deployment recipe. Remote changes require a separately reviewed execution
boundary and explicit user approval.

## API Contract

All supported operations use existing authenticated vault requests. Successful
mutations return HTTP `200` with an empty body. List responses use
`{object: "list", data: [...], continuationToken: null}`. Member and public-key
records emit PascalCase fields; request parsers accept case variants but reject
duplicate fields after case normalization. Responses use `Cache-Control: no-store`.

| Method | Path below `/api/organizations/{organizationId}` | Purpose                                                                |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| GET    | `/users`                                         | Manager-only member list; optional `includeCollections=true`           |
| GET    | `/users/{membershipId}`                          | Manager reads one sanitized same-organization membership record        |
| POST   | `/users/invite`                                  | Atomic bounded invitation batch                                        |
| POST   | `/users/{membershipId}/accept`                   | Matching authenticated recipient accepts a token                       |
| POST   | `/users/public-keys`                             | Manager retrieves requested accepted/confirmed recipients' public keys |
| POST   | `/users/{membershipId}/confirm`                  | Manager stores the opaque recipient-specific wrapped organization key  |
| PUT    | `/users/{membershipId}`                          | Replace role and the complete collection assignment set                |
| POST   | `/users/{membershipId}/reinvite`                 | Rotate an invited member's token and attempt delivery again            |
| PUT    | `/users/{membershipId}/revoke`                   | Withdraw membership access and clear key/token/grants                  |
| DELETE | `/users/{membershipId}`                          | Remove membership after advancing the recipient polling revision       |

The eleventh route is `GET /api/users/{userId}/public-key`, outside that
organization-prefixed table. It returns `Object: "userKey"`, `UserId`, and
`PublicKey` only. A confirmed active Owner, or an Admin managing a User recipient,
must share an enabled organization with the active accepted/confirmed recipient.
There is no global arbitrary-account public-key lookup. Neither read helper needs
the invitation secret or mailer binding; the membership feature gate still applies.

Identifiers contain 1–128 ASCII letters, digits, underscores, or hyphens. List
queries permit only single `true`/`false` values for `includeGroups` and
`includeCollections`. `includeGroups=true` returns `501 unsupported_feature`.
Invited and revoked members can appear in the manager list but gain no vault access.
The list and single-member detail response never contain wrapped organization
keys, invite verifiers, or tokens. Authorized managers may inspect invited or
revoked detail records for lifecycle management; such records grant no vault access.

Synthetic invitation example, for request shape review only:

```json
{
  "emails": ["colleague@example.test"],
  "type": 2,
  "collections": [
    {
      "id": "collection-example",
      "readOnly": true,
      "hidePasswords": false,
      "manage": false
    }
  ]
}
```

An invitation contains 1–20 distinct normalized emails. Normalization follows
account email trimming/lowercasing, with additional shape/control-character checks
and a 254 UTF-8 byte bound. Duplicate recipients are rejected, not deduplicated or
silently truncated. Omitted invitation `collections` defaults to an empty set.
The whole batch is refused if any requested collection is outside this organization
or any recipient already has a membership row here.

Each collection assignment has `id`, `readOnly`, `hidePasswords`, and `manage`.
Omitted booleans default to `false`; non-booleans and duplicate IDs are rejected.
There are at most 100 assignments per request. Role/grant updates require both
`type` and `collections`; an explicitly empty collection array removes all grants.
There is no partial-patch or wrapped-key mutation through that update endpoint.

Acceptance uses `{token}`. Confirmation uses `{key}` and accepts an opaque,
nonempty recipient-specific ciphertext up to 65,536 UTF-8 bytes. The current
client's optional `defaultUserCollectionName` is accepted as bounded opaque
metadata (at most 65,536 UTF-8 bytes; null/empty is neutral) and ignored because
the organization response hard-declares `UseMyItems: false`. The upstream server
likewise skips default collection creation when that feature is disabled.
Confirmation does not create My Items or a new default collection.

Bulk public-key lookup
uses `{ids: [...]}`, with 1–100 distinct membership IDs. Lookup is all-or-none:
invited/revoked members, disabled recipients, missing public keys, or foreign IDs
cause refusal rather than partial disclosure. Its response uses `Id`, `UserId`,
and `Key`, with `Object: "organizationUserPublicKeyResponseModel"`. This bulk
`Key` is a public key, not another member's wrapped organization key; the direct
user-key endpoint instead uses the upstream `PublicKey` field.

The only roles are Owner `0`, Admin `1`, and User `2`. Custom role `4`, nonempty
groups, permission-bearing objects, and `accessAll: true` return
`501 unsupported_feature`. Empty groups/permissions and `accessAll: false` are
accepted as neutral values. The current client's empty PermissionsApi constructor
serializes `{response: null}`; exactly that wrapper is also neutral. Other
permission fields remain unsupported. Current request defaults
`accessSecretsManager: false` and `accessPam: false` are neutral; either flag true
is explicitly unsupported, and non-boolean values are invalid.
Unknown fields and malformed payloads return `400 invalid_request`. Membership
authorization failures and disallowed transitions generally return the opaque
`404 organization_not_found`; existing-recipient invitation conflicts return
`409 membership_conflict`. Infrastructure failures return `503` with a request ID,
without upstream exception details or secret material.

## Role And Collection Invariants

| Actor                                                         | Membership management authority                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Confirmed active Owner                                        | Manage Owner, Admin, and User memberships, subject to last-Owner protection                     |
| Confirmed active Admin                                        | List members/public keys and manage User memberships only; cannot create or promote Owner/Admin |
| User, unconfirmed member, revoked member, or disabled account | No membership administration                                                                    |

Authorization is evaluated inside D1 mutation batches, including enabled
organization and active actor account checks. Another enabled, confirmed Owner
with an active account must remain before a confirmed Owner is demoted, revoked,
or removed. Concurrent Owner changes must preserve this invariant. Merely invited,
accepted, revoked, or disabled Owners do not count as the surviving Owner.

A role grants membership-management authority; it does not automatically grant
access to every collection or cipher. Vault reads require a confirmed supported
role, an enabled organization, and a mapped collection assignment. Invited,
accepted, revoked, unsupported-role, unassigned, and cross-organization callers
are excluded from shared data. Personal vault ownership remains independent.

Collection permission dimensions are independent:

- `readOnly: false` on at least one assigned collection containing a cipher permits
  that cipher's supported edit/delete operations. `manage` is not required for
  ordinary cipher edits. A writable assignment on an unrelated collection cannot
  authorize the cipher.
- `manage` governs collection administration. Existing collection CRUD remains
  Owner-managed; changing/deleting a collection requires the corresponding
  `manage` grant and `readOnly: false`. Read-only/nonmanager assigned members can
  read their collection metadata.
- `hidePasswords: false` on at least one assigned mapped collection yields
  `ViewPassword: true`; otherwise the projected value is `false`. This dimension
  does not implicitly alter write permission.

**`hidePasswords` is a trusted-client UI permission, not cryptographic password
separation.** An assigned member receives opaque encrypted cipher data and an
organization key. A custom client may decrypt information that the official UI
hides. Do not use this flag as the company's security boundary for secrets that
a member must never learn. Separate keys/vaults and verified cryptographic controls
are required for that requirement.

Shared cipher creation/sharing checks every requested collection belongs to the
same organization and is writable for the actor. Normal shared-cipher mutation
preserves organization ownership and collection mappings. This membership slice
does not promise complete parity for every group, policy, or administrative UI
in all clients.

### Single-Cipher Mutation Contract

The actual application routes support assigned confirmed Owner/Admin/User reads
and the following single-ID shared-cipher writes. A writable mapped assignment
(`readOnly: false`) authorizes writes independently of `manage`; a historical
creator's personal `user_id` is not an organization access bypass. Response `edit`
and `viewPassword` values come from current mapped grants, not request values.

| Method | Path                              | Supported organization behavior                                           |
| ------ | --------------------------------- | ------------------------------------------------------------------------- |
| PUT    | `/api/ciphers/{cipherId}`         | Update opaque encrypted payload with a mandatory current revision         |
| PUT    | `/api/ciphers/{cipherId}/delete`  | Trash one authorized cipher                                               |
| PUT    | `/api/ciphers/{cipherId}/restore` | Restore one authorized trashed cipher                                     |
| DELETE | `/api/ciphers/{cipherId}`         | Permanently delete one authorized attachment-free cipher and its mappings |

Payload updates require the current `revisionDate` (the existing parser also
accepts `lastKnownRevisionDate`). The SQL compare-and-swap requires an exact
revision match and rechecks membership, enabled organization, and mapped writable
grants at the write. A stale revision returns `409 revision_conflict` without
changing either encrypted payload or wrapped cipher key. An optional `key` must
be a nonempty opaque string of at most 65,536 UTF-8 bytes; a supplied key and the
encrypted payload change together in the same compare-and-swap. Omitting `key`
preserves the current key. Organization ownership cannot change through this
update, and a non-null personal `folderId` is unsupported. Use the dedicated
assignment operation for collection changes; update body `collectionIds` does
not replace persisted mappings.

Trash, restore, and permanent-delete routes do not take a client revision guard
in a request body. Their SQL still rechecks grants at mutation time, but these
routes do not promise stale-client compare-and-swap protection. Perform current
state readback before an intentional destructive operation. Organization cipher
attachments are unsupported: attached rows are refused before metadata loss,
and the organization permanent-delete path does not perform R2 object deletion.
Organization bulk lifecycle operations and organization attachment flows remain
unsupported; do not infer their support from the single-ID routes.

Cipher content changes use the existing configured vault audit path, which emits
audit after the mutation. This differs from mandatory same-batch membership
audit. If that configured audit sink fails, the cipher change may already have
committed when the API returns `503`; read the current state before retrying.
See [audit persistence and failure behavior](audit-events.md).

## Invitation And Key Lifecycle

Membership status is Invited `0`, Accepted `1`, Confirmed `2`, or Revoked `-1`.
Invite grants can be stored before acceptance but are effective only after
confirmation. The server never generates, derives, or decrypts the organization
key. A manager's client wraps it to the intended recipient's public key and submits
that recipient-specific ciphertext at confirmation. The server stores and routes
the opaque value; it cannot prove the client encrypted it to the correct key.
Each member's profile/sync must receive that member's own wrapped key. Listing
members or public keys must never disclose another member's wrapped key.

Each invitation uses 32 random bytes encoded as a canonical 43-character unpadded
base64url token. Only the domain-separated HMAC-SHA-256 verifier is persisted,
bound to organization ID, membership ID, normalized recipient email, and token.
Its lifetime is five days. The matching active authenticated account must accept
before expiration; the SQL condition uses a strict future expiry and clears the
verifier/expiry during the single-use transition to Accepted. Wrong-recipient,
expired, reused, and cross-organization tokens do not activate membership.

Confirmation changes Accepted to Confirmed once. Reinvite applies only to an
Invited row and replaces its verifier and expiry, invalidating the previous token.
It does not reset accepted/confirmed members or restore revoked memberships.
There is no restore/reactivate endpoint in this slice. To add a removed recipient
again, use a new intentional invitation after verifying the old row is removed.

Revoke clears the wrapped key, token/expiry, and collection grants. Remove clears
access, advances the recipient's revision beyond disappearing shared data, and
deletes the membership row and dependent assignments in the batch. Organization
revisions also advance on successful membership changes. Clients still need to
poll/sync; local tests are not proof of live notification or immediate local-cache
erasure.

## Partial Delivery And Recovery

D1 commits membership rows, grants, redacted audit events, and revision updates
atomically. Sending invitation messages happens afterward and cannot join that
transaction. Delivery attempts run sequentially. If one fails or its outcome is
ambiguous, earlier recipients may have received invitations and later recipients
may not have been attempted; every membership in the batch remains committed.

The API returns `503 invitation_delivery_unavailable`, `persisted: true`, the
batch `membershipIds`, and a request ID. This is not a rolled-back invitation
batch or a recipient-by-recipient delivery receipt. Do not blindly retry the
original invitation request or infer that no message was sent.

1. Preserve the request ID and returned membership IDs in a restricted incident
   record. Never copy tokens, message bodies, or wrapped keys into it.
2. Read the manager membership list to determine whether each row remains Invited
   or has already been Accepted/Confirmed. Resolve concurrent state changes from
   current state, not the original response.
3. For a row still Invited, intentionally reinvite that membership to rotate the
   verifier and invalidate any earlier invitation link. Inform the recipient via
   the reviewed delivery process that the newest invitation replaces the older one.
4. If reinvite delivery is also uncertain, repeat state readback and investigate
   transport evidence. Do not reuse or attempt to recover raw tokens from logs.
   Accepted/Confirmed rows need their normal next lifecycle step, not reinvitation.

Successful lifecycle changes persist sanitized `organization.member.*` audit
events in the same D1 batch. Transport and database failures emit sanitized
`organization_membership_failed` records with code, operation, and request ID.
Audit mutation success proves persistence, not mailbox delivery. Assign an
operational owner for `503` rates, pending invitation age, audit storage/backlog,
and mailer acceptance-to-delivery discrepancies before company use.

## Offboarding And Company Acceptance

Revocation prevents future authorized server reads/writes after state readback; it
cannot recall plaintext, wrapped keys, cached ciphertext, or exports a member
already obtained. Offboarding therefore also needs an incident-aware credential
rotation plan for secrets the departing member could know. Rotate the organization
cryptographic key and re-encrypt/re-wrap affected data through a separately
designed, verified process when the threat model requires it; automatic
organization-key rotation is not implemented by revoke/remove. Do not overwrite
the remaining members' wrapped keys manually or equate account user-key rotation
with organization-key rotation.

Before real company secrets, require distinct acceptance evidence for:

- The final source candidate: domain/parser tests, real local D1 atomic lifecycle
  tests, cross-user isolation, last-Owner races, opaque-key projection, revision
  guards, shared-cipher permissions, and personal-vault regressions.
- Each exact official client/platform/version the company will use: two independent
  synthetic accounts completing invitation delivery, acceptance, key wrapping,
  confirmation, sync/decrypt, permitted edits, denied reads/writes, and revocation
  observed by the client's next sync. Verify actual request shapes and UI behavior.
- A separately approved runtime: migration/readback, default flag state, scoped
  configuration, audited delivery transport, observability, rollback, and backup
  recovery evidence against the same candidate. A green local test or old deployment
  record does not establish this evidence.
- Independent security review and a company owner accepting documented limits,
  including trusted-client password hiding and post-offboarding secret rotation.

Relevant local tests are
`test/domain/organization-membership.test.ts`,
`test/app-organization-membership.test.ts`,
`test/integration/organization-membership-d1.test.ts`,
`test/integration/organization-authorization-d1.test.ts`,
`test/integration/organization-cipher-mutations-d1.test.ts`, and
`test/integration/organization-revision-d1.test.ts`, plus actual application route
coverage in `test/integration/organization-cipher-routes-d1.test.ts`. They use
synthetic accounts, keys, mailer adapters, and local D1. The two-account membership
API crypto test exercises recipient-specific RSA key wrapping and authenticated
symmetric cipher decryption; it is distinct from the native CLI personal-vault
proof. Neither proof establishes the official client's organization management
UI or remote environment acceptance.

Migration `0024_organization_invitations.sql` is additive. Preserve membership,
audit, and invitation state for diagnosis; destructive down-migration is not a
recovery action. Source rollback, flag containment, and any remote repair require
a reviewed plan that accounts for already committed invitations and previously
distributed keys. Disabling membership routes alone cannot recall distributed
data or erase memberships.
