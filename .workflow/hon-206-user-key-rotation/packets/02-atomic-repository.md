# Packet 02: guarded atomic D1 rotation

## Objective

Commit one complete supported user-key generation or no state at all under D1's
current statement/parameter/time limits.

## Acceptance

- Read one exact active server snapshot for user credentials, complete V1 keys,
  personal folders/ciphers, uploaded attachments, and trusted devices.
- Reject deleted rows, pending attachments, set mismatch, stale observable
  revisions, foreign ownership, and requests over the statement budget before
  `batch()`.
- Guard the user update by old hash, salt/KDF, keys, security stamp, revision,
  and compact exact ID/revision manifests.
- Update all supported ciphertext and trusted-device wrapped keys, rotate stamp
  and revision, revoke D1 sessions, supersede auth requests, and insert exactly
  one redacted audit in the same batch.
- Keep R2 object keys and bytes outside the transaction and unchanged.
- Return conflict for a zero-generation race and throw loudly for invalid batch
  shape/counts.
- Prove forced abort and concurrency on real local D1.

## Boundary

No public route, Durable Object mutation, production database, or old-generation
rollback belongs to this packet.
