# Packet 01: pinned contract and strict domain parser

## Objective

Implement pure V1 request parsing and immutable rotation manifests from the
pinned server/client source without adding a route or database mutation.

## Acceptance

- Exact top-level and nested allowlists with camel/Pascal alias consistency.
- Bounded old/new authentication hashes, wrapped user key, V1 account keys,
  folder/cipher/attachment ciphertext, and device wrapped keys.
- Unchanged email salt and KDF structure; V1 dual account-key fields agree.
- Every unsupported product array is present-empty or absent only where pinned
  JSON permits it; any non-empty value fails.
- Folder, cipher, attachment, and device IDs are unique and bounded.
- Cipher immutable metadata and observable revisions are represented for later
  server-snapshot validation.
- Tests fail first for malformed, duplicate, partial, V2, oversize, stale, and
  metadata-changing candidates.

## Boundary

No route, D1, configuration, deployment, real credential, or compatibility
promotion belongs to this packet.
