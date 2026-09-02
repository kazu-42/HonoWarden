# HON-184 Encrypted Text Send Lifecycle

## Goal

Implement the encrypted text Send data model, cryptographic storage boundary,
owner lifecycle, and atomic text-access core required by ADR 0011 without
mounting or activating Send routes.

## Invariants

- Raw access capabilities and client-derived password inputs are never stored.
- Capability envelopes and lookup/password verifiers use independent roots.
- Text payload fields remain opaque ciphertext and are never parsed or logged.
- Owner reads and mutations bind `owner_user_id`; foreign and missing IDs are
  indistinguishable.
- Security-relevant updates advance `access_generation`; deletion is terminal.
- Text access counting is one conditional `UPDATE ... RETURNING`, never a
  read-then-write sequence.
- Runtime `/api/sends*` and `send_access` remain `501`; config remains disabled.

## Packets

1. `S2-A`: additive D1 schema, request validation, capability envelope, lookup
   verifier, and password verifier.
2. `S2-B`: owner create/list/get/update/remove-auth/delete repository and atomic
   text-access consumption.
3. `S2-C`: unmounted owner application service and compatibility projection.
4. `S2-D`: migration/full verification, bounded review, publication, and exact
   Linear closeout.

## Excluded

File metadata/R2, public token issuance, anonymous route mounting, abuse-report
operations, runtime activation, deploys, secret writes, and production changes.
