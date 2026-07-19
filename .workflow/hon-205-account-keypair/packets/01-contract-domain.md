# Packet 01: contract and domain

## Objective

Freeze the supported V1 account-key envelope and encode strict input and stored
state behavior as domain tests before route or database work.

## Ownership

- `src/domain/account-keys.ts`
- `test/domain/account-keys.test.ts`
- `.workflow/hon-205-account-keypair/results/01-contract-domain.md`

## Verification

- Focused domain tests demonstrate red before implementation and green after.
- The result records pinned source paths and rejected V2 fields without copying
  opaque values into evidence.
