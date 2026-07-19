# Packet 04: Linear child DAG

## Objective

Create six one-PR children under HON-160 and make execution order visible.

## Planned children

- AUTH-2A: mutation foundation and explicit security-stamp rotation.
- AUTH-2B: verify-password and existing master-password change.
- AUTH-2C: PBKDF2 and Argon2id KDF mutation.
- AUTH-2D: account keypair read and one-time initialization.
- AUTH-2E: atomic user-key rotation across supported personal-vault data.
- AUTH-2F: official-client lifecycle, rollback, and compatibility closeout.

## Relation graph

- AUTH-2A blocks AUTH-2B, AUTH-2C, and AUTH-2D.
- AUTH-2B and AUTH-2D block AUTH-2E.
- AUTH-2B, AUTH-2C, AUTH-2D, and AUTH-2E block AUTH-2F.

## Safety

Use a canonical roadmap key in every description. Never adopt a title-only
collision. Guard all discovered children before relation finalization. On apply
failure, leave every managed issue visible and non-actionable, then fail.

## Output

Deterministic manifest/synchronizer tests plus canonical and independent
readback artifacts under `results/`.
