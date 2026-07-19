# Packet 01 result: contract and domain

## Pinned contract

- Server `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`:
  `src/Api/Auth/Controllers/AccountsController.cs`,
  `src/Core/Auth/Models/Api/Request/Accounts/KeysRequestModel.cs`, and
  `src/Api/Models/Response/KeysResponseModel.cs`.
- Clients `39f07436ca60e3f25eac47777671754f288a98f1`:
  `libs/common/src/models/request/keys.request.ts` and
  `libs/common/src/models/response/keys.response.ts`.
- Supported request fields are V1 `publicKey` and `encryptedPrivateKey`.
  HonoWarden accepts their Pascal aliases only when duplicate values are exact.
- The response contract carries the wrapped user key, legacy public/private
  fields, and nested public-key-encryption metadata. The private response value
  is the wrapped private key, never an unwrapped key.

## Decisions

- Request keys are a strict allowlist. V2 account keys, signature keys,
  security state, signed public keys, and unknown future fields are rejected.
- Public and wrapped-private values are opaque, untrimmed, control-free strings
  bounded independently to 32,768 UTF-16 code units.
- Stored key state is exactly `missing` when both columns are null, `complete`
  when both values pass the same bounds, and `invalid` otherwise.
- Exact replay compares both values with full-length constant-time scans.
- Official server first initialization advances account revision but does not
  rotate the security stamp. HON-205 preserves existing sessions and proves
  this policy explicitly.

## TDD evidence

- Red: the focused suite failed because `src/domain/account-keys.ts` did not
  exist.
- Green: `test/domain/account-keys.test.ts` passed 8/8 tests after the minimal
  parser/state implementation.

No key payload, credential, production mutation, remote D1 action, or
compatibility promotion is contained in this evidence.
