# Encrypted Text Send Lifecycle

## Scope

HON-184 adds the inactive data and application foundation for owner-managed
encrypted text Sends. It does not mount owner or public HTTP routes, enable the
Send feature flag, issue Send tokens, or change deployed resources.

## Inputs

- An authenticated owner identifier supplied by the future route layer.
- A case-insensitive owner request with text `Type: 0`, opaque encrypted name,
  notes, key, and text fields, required `DeletionDate`, optional
  `ExpirationDate`, and password or no authentication.
- Independent versioned secrets for owner capability envelopes and indexed
  lookup/password verifiers.
- An expected revision for owner updates and an access generation for public
  consumption.

## Outputs

- D1 rows containing only opaque encrypted payload fields, an AEAD capability
  envelope, purpose-separated keyed verifiers, lifecycle state, counts, and
  retention timestamps.
- Owner-scoped repository results suitable for a later compatibility
  projection.
- A single conditional access-consumption result that either increments the
  count and returns the row or exposes no row.

## Required Behaviour

1. Create generates a 16-byte random public capability, returns it only to the
   caller, and stores an encrypted envelope plus a keyed verifier. The raw
   capability and client password input never enter D1 or audit context.
2. Request parsing treats decoded protocol-object field names
   case-insensitively, rejects case-colliding decoded keys, unsupported email
   authentication, inconsistent auth fields, invalid date ordering, and a
   maximum below the consumed count.
3. List, update, auth removal, and delete always include `owner_user_id` in the
   D1 predicate. Missing and cross-owner IDs therefore have the same result.
4. Owner updates can transition only from active, disabled, or computed-expired
   state. Quarantine is operator-controlled, requires `quarantined_at`, and
   cannot be released by an owner update even if a legacy row lacks that
   timestamp.
5. Security-relevant updates increment `access_generation`. Repeated auth
   removal and delete are idempotent for retained owner rows.
6. Text access is one `UPDATE ... RETURNING` guarded by verifier, generation,
   active/disabled/quarantine state, expiration, deletion, and access count.
7. Deletion is a retained tombstone. Physical cleanup and all file/R2 state are
   deferred to later slices.

## Validation Limits

- Deletion must be after `now` and no more than 31 days ahead.
- Expiration is optional, after `now`, and no later than deletion.
- Maximum access count is optional, integral, at least one, and not below the
  current access count.
- Opaque strings are bounded by encoded UTF-8 bytes without parsing their
  encrypted contents.
- Envelope and lookup roots must each be at least 32 encoded bytes and use
  explicit non-empty key identifiers. A lookup/password root must differ from
  every active or previous envelope read root before a security-state mutation.
- The current application service receives an already-decoded object. Before an
  HTTP route can be mounted, the route layer must use a bounded duplicate-aware
  JSON decoder so exact duplicate raw members cannot be collapsed by
  `JSON.parse` before validation.

## Failure Semantics

- Invalid owner input returns `{ ok: false, code: "invalid_request" }` without
  partial acceptance.
- An owner-scoped initial miss returns non-revealing `not_found`. If a row was
  read successfully but an intervening owner mutation makes the captured next
  revision non-advancing and the conditional write misses, the application
  returns `conflict`, not a false `not_found`. A later candidate revision may
  instead linearize as a subsequent valid mutation. No read-before-write
  fallback is permitted for public access counts.
- A partially applied create batch throws because the row and redacted audit
  event are one logical write.
- Cryptographic configuration or envelope authentication failures throw loudly.

## Acceptance

- Migration-chain tests apply every ordered migration to a fresh local D1
  database, including migrations that define triggers.
- Domain tests cover decoded case-collision ambiguity, auth/date/count
  rejection, envelope recovery, purpose-separated verification, and wrong-key
  failure. Raw duplicate-member rejection remains an activation-gate test for
  the future route decoder.
- Repository tests prove owner predicates, tombstone/idempotency behaviour, no
  secret audit bindings, quarantine containment, public failure-state
  immutability, and a one-statement access increment.
- Existing Send routes and `send_access` remain explicit `501` responses and
  `send-enabled` remains false.
