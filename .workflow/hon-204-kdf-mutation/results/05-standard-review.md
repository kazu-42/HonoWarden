# Standard review

Initial reviewed commit: `7f8c4d4c0ec7329ed44fc814001ae25a2b94dc55`

Second reviewed commit: `f32f1f71d1d6ce9761326ac35c44c10b91270495`

Status: second remediation complete; exact-head re-review pending

## Finding

- P1: the same build first added Argon2id readers and unconditionally exposed
  the writer. A rollback to parent `f329b11595987f6754f60bc19f426e0d6fa09392`
  would project a committed Argon2id generation as PBKDF2 and make the account
  unusable until roll-forward.

## Remediation

- added default-off `HONOWARDEN_KDF_MUTATION_ENABLED`
- return state-free `501 unsupported_feature` before auth or D1 access unless
  the flag is exact true
- kept every PBKDF2/Argon2id reader active independently of the writer
- pinned top-level, staging, and production Wrangler values to false
- made only the isolated local lifecycle opt in explicitly
- documented two-stage activation and prohibited rollback to a pre-reader build

## Verification

- focused remediation suite: 4 files, 317 tests
- full suite: 86 files, 1,037 tests
- compatibility suite: 3 files, 101 tests
- real local D1 lifecycle: 17 checks
- typecheck, lint, format, diff check, brand scan, release gate, and workflow
  verifier passed

The remediation changes the candidate head, so the initial review is not a
merge approval. A clean standard review must run again on the final exact head.

## Second Review Findings

- P2: the server-compatible 15 MiB Argon2 lower bound is rejected by the pinned
  client's setting and prelogin validation, so committing it could strand the
  account after old sessions are revoked.
- P2: a fixed PBKDF2 response for every unknown allowlisted account makes any
  known non-default KDF response a deterministic account-existence signal.

## Second Remediation

- narrowed Argon2 memory to the pinned server/client intersection
  `16..1024` MiB and added an explicit 15 MiB rejection regression
- replaced the fixed unknown-account response with an email-stable,
  `HONOWARDEN_TOKEN_SECRET`-keyed HMAC selection over client-valid PBKDF2 and
  Argon2id decoys
- compute a decoy selection for both known and unknown generations, but always
  project the exact validated stored generation for a known account
- fail allowed prelogin with `503 server_misconfigured` before D1 when the
  secret is missing, without logging the email or secret

Focused remediation verification passed 3 files and 307 tests. Because this
remediation changes code again, broad verification and both exact-head reviews
must rerun before merge approval.
