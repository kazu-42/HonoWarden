# Packet 03: Test, failure, and rollback matrix

## Objective

Define the evidence required to prove that credential mutations are atomic,
non-enumerating, replay-safe, and recoverable without production access.

## Do

- Cover malformed variants, KDF/salt mismatch, invalid current hash, stale
  stamp/revision, concurrent mutation, D1 failure, audit failure, old access and
  refresh tokens, old password, unsupported payloads, and successful relogin.
- Define fresh local D1 and official-client synthetic evidence separately.
- Define rollback and feature-disable behavior per child.

## Do Not

- Do not use a real account, password, key, vault item, or production Worker.

## Output

`results/03-test-rollback.md`

## Verification

Every acceptance criterion must have at least one positive and one fail-closed
evidence path.
