# Packet 02 result: atomic personal-vault rotation repository

## Status

Completed on the HON-206 branch. This packet adds snapshot validation and a D1
transaction repository only. It does not add or enable an API route, deploy a
Worker, mutate remote D1/R2, rotate a real credential, or promote compatibility.

## Repository contract

- `rotateUserKeyGeneration` owns the complete read, validation, budget, CAS,
  mutation, session revocation, and audit contract so a route cannot skip a
  repository invariant.
- One aggregate query rejects disabled accounts, deleted personal records,
  pending attachments, partial trusted-device keys, personal `cipher_key`
  columns, row-count overflow, and snapshot-byte overflow before large rows are
  read or `batch()` is entered.
- Four bounded detail queries read exact active folders, personal ciphers,
  uploaded personal attachments, and complete active trusted devices. The
  request must contain the same unique owned IDs, folder links, observable
  revisions, and immutable cipher metadata.
- Existing cipher JSON is parsed independently. Invalid stored metadata returns
  `unsupported_state`; a valid but changed immutable value returns `conflict`.
  An omitted legacy `reprompt` is the protocol default `0`.
- Folder/cipher/attachment/device ciphertext and wrapped values must move to a
  new generation. Account salt, KDF, public key, R2 object key, object bytes,
  attachment size/content type, and trusted-device private key stay unchanged.

## Atomicity and limits

- Current row snapshots are serialized as sorted JSON manifests. The first
  users CAS validates the exact folder, personal-cipher, uploaded-attachment,
  and trusted-device sets inside D1 with `json_each`, including old ciphertext,
  revisions, object identity, and nullable values.
- Eight downstream statements are gated by the newly committed security stamp
  and revision: folder, cipher, attachment, trusted-device updates; all-device
  and all-refresh revocation; auth-request supersession; and one audit insert.
- The fixed budget is five snapshot queries plus nine transactional statements,
  14 total. Every statement is checked before preparation against 50 queries,
  100 bound parameters, 100 KB SQL, and 2 MB bound-value limits. Each manifest
  is additionally capped at 1.8 MB.
- A lost users CAS requires every downstream change count to be zero and returns
  `conflict`. Any statement error is allowed to propagate; D1 rolls the whole
  batch back. Unexpected counts fail loudly as an invariant violation.
- The attachment UPDATE changes only encrypted file name/key and revision/time.
  It never assigns `object_key`, `size`, or `content_type`, and no R2 binding is
  accepted by the repository.

## TDD and verification

- Red: the focused repository suite failed because
  `src/repositories/user-key-rotation-repository.ts` did not exist.
- Fake D1: 18 tests cover exact success/counts, statement/bind budgets,
  unsupported state, foreign/missing/stale/metadata-changing manifests,
  generation conflict, snapshot overflow, protocol defaults, lost-race zero
  writes, guard violations, and statement failure propagation.
- Real local D1 (Miniflare/workerd): four tests cover empty manifests, populated
  success/readback, R2 identity sentinel fields, duplicate final-audit rollback,
  and concurrent one-winner/one-conflict serialization.
- Focused repository plus integration: 2 files and 22 tests pass.
- Full suite: 92 files and 1,135 tests pass.
- `pnpm check`, full `pnpm lint`, and full `pnpm format` pass.
- `pnpm audit --audit-level low` reports no known vulnerabilities. The direct
  Miniflare test dependency and new lock hash are recorded in
  `docs/security/dependency-audit.md`.
- Strict release gate reports 11 pass, 0 manual, 0 block.

## Packet 03 handoff

Packet 03 must keep the route exact-true/default-off and D1-free while disabled,
authenticate and prove the old password generation before mutation, map
`not_found`, `unsupported_state`, `over_budget`, and `conflict` without leaking
secrets, preflight notification cleanup, invoke this repository once, and only
acknowledge after D1 commits. Old access/refresh generations must fail and the
new login/profile/sync projection must read one complete generation.
