# Packet 01 result: pinned V1 contract and domain parser

## Status

Completed on the HON-206 branch. No route, D1 mutation, configuration change,
deployment, real credential, or compatibility promotion is included.

## Pinned sources

- Server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`:
  `RotateAccountKeysAndDataRequestModel.cs`, `UnlockDataRequestModel.cs`,
  `UserDataRequestModel.cs`, `AccountKeysRequestModel.cs`,
  `MasterPasswordUnlockDataAndAuthenticationModel.cs`, the folder/cipher/
  attachment/device request models, rotation validators, and
  `RotateUserAccountKeysCommand.cs`.
- Clients `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`:
  the web key-rotation service and its account-key, unlock-data, user-data,
  folder, cipher, attachment, and device request models.

## Result

- `parseUserKeyRotationBody` accepts the complete supported V1 master-password,
  duplicated account-key, personal folder/cipher/attachment, and trusted-device
  envelope through exact camel/Pascal aliases.
- Unknown fields, conflicting aliases, partial data, non-empty Send, Emergency
  Access, organization recovery, passkey, V2-upgrade, signature/security state,
  organization-owned data, unsupported cipher types, invalid dates, duplicate
  IDs, foreign folder references, and oversized values fail before a manifest
  is produced.
- PBKDF2 and Argon2id use the existing HonoWarden credential-policy intersection.
  Salt is the normalized account email and a supplied master-password salt must
  agree exactly. Non-empty hints remain unsupported because HonoWarden has no
  durable hint field in this slice.
- Legacy and `publicKeyEncryptionKeyPair` V1 values must agree exactly. The
  generation matcher additionally requires the stored KDF and public key to be
  unchanged while both wrapped user/private values move forward.
- The typed cipher manifest separates rotated ciphertext from immutable
  metadata: owner, organization nullness, folder, type, favorite, reprompt,
  archive date, revision, URI match modes, password dates, FIDO creation dates,
  field types/links, secure-note type, and attachment membership/revisions.
- Attachment legacy/modern maps must have the same IDs and encrypted file names;
  every supported attachment also carries a new encrypted key and the same
  observable cipher revision. R2 object identity and bytes are not represented
  by the client request and remain a server-side Packet 02 invariant.

## TDD and verification

- Red: the focused suite failed because
  `src/domain/user-key-rotation.ts` did not exist.
- Green: `test/domain/user-key-rotation.test.ts` passes 13/13 tests.
- Aggregate domain: 14 files and 174 tests pass.
- `pnpm check` passes.
- Focused ESLint and Prettier checks pass.

The attempted pre-commit `codex review --uncommitted` completed source and test
inspection but did not produce a verdict because its isolated subprocess could
not resolve the package-manager registry and remained in upstream-source
discovery. It was terminated without modifying files. The required exact-head
standard and five-axis reviews remain Packet 04 gates.

## Packet 02 handoff

Packet 02 must compare every typed manifest against an exact current server
snapshot before constructing a D1 batch. It must reject extra, missing, deleted,
pending-upload, stale, metadata-changing, foreign-owner, incomplete-key, or
statement-over-budget state without entering `batch()`.
