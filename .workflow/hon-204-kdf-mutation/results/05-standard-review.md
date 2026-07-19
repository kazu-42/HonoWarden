# Standard review

Initial reviewed commit: `7f8c4d4c0ec7329ed44fc814001ae25a2b94dc55`

Status: remediation complete; exact-head re-review pending

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
