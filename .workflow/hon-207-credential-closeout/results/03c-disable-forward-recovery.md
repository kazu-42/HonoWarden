# RECOVERY-1C: Default-Off Writers And Forward Recovery

Status: local implementation and integrated proof passed; exact-head review and
repository publication remain

Linear issue: HON-226

## Scope

- local synthetic D1/R2 and pinned official CLI only
- same generation-bound restored target across disable and re-enable phases
- no deployment, remote resource, real account, normal browser profile,
  destructive operation, paid action, or third-party contact

## Delivered

- Added tracked `HONOWARDEN_PASSWORD_CHANGE_ENABLED=false` defaults and a
  route-local gate so password change joins KDF mutation, account-key
  initialization, and user-key rotation behind one four-writer rollout
  boundary.
- Disabled POST and Hono-derived HEAD return `501 unsupported_feature` before
  authentication, global quota, or D1 access. Enabled GET/HEAD remain method
  rejected with `Allow: POST`.
- Added `pnpm account:credential-forward-recovery` with dry-run planning,
  explicit execution confirmation, direct-child private run roots, and no
  remote-resource selector.
- Extended the official fixture with one forward password generation and kept
  all plaintext, tokens, keys, profiles, and ciphertext in process or ignored
  private state.
- Added a same-target proof that snapshots canonical D1 and sorted R2 identity
  after restore, compares it after every disabled writer, then re-enables the
  same persistence path without reset.
- Added exact lifecycle-to-backup digest binding verification. Public readback
  distinguishes the source `lifecycleManifestSha256` from the derived
  `generationBindingSha256`; the compatibility alias remains available.

## Local Integrated Readback

The 2026-07-22 run passed with:

- all four disabled writer statuses: 501
- canonical disabled D1 SHA-256:
  `1df5a52f3453fe8a359edf9b8d525be1603ff79fd57befa27f6ff3e7d1c21dc7`
- sorted disabled R2-set SHA-256:
  `73b50a1cec316410c836ed59684a3c5470e6b9f1af6252607273142682e6b7dc`
- combined disabled identity SHA-256:
  `7c31ccacb4d741c956dcc79df100035c0d7c0648d70b26d14ac3e6a4cb02e106`
- concurrent forward responses: one 200 and one 409
- replay response: 401 with D1/R2 unchanged
- security stamp and revision advanced once; audit delta 1; wrapper-history
  generation delta 1; R2 unchanged
- five prior password, access-token, refresh-token, and authenticated profile
  generations rejected after restart
- forward official CLI item read passed before and after restart
- final audit rows 6, wrapper-history rows 8, foreign-key violations 0
- generated bridge SHA-256:
  `af6214f87853023a86045bb4fc468cd953594e2e357a0ca66e2d52727f467b46`
- prepared runtime manifest SHA-256:
  `b45b4cd4b8bc1ec149f7d948867968ae5171190dab164c0c50f865aac34330e3`
- run root removed and retained secret files 0

After strengthening the forward restart proof from one prior profile to all
five prior profiles, the final integrated rerun at
`2026-07-21T23:52:12.394Z` also passed with:

- source lifecycle manifest SHA-256
  `8fef2dc8ba552fa00bc17b553627df0932b966dcebc76d08af2152657d2a63ac`
- generation-bound backup manifest SHA-256
  `43faf539d2326fe33606b5ddeb102c96464d181e6aae308db55b3f1e91f33e46`
- source lifecycle binding SHA-256
  `42afc170a76184bdba4bda0b36da3431606f9a7b9f79fcf1735f28cb4aa0cd80`
  explicitly derived from the lifecycle digest above and source-state SHA-256
  `f50ba504db2afd5414499d374cbf79c4171f9174d755229520f7b519501e9b9c`
- restored D1 SHA-256
  `648e9e111b8d32859377e17f5e21e1f70b94f22b9523b406b5b1ec716389dae5`
  and one exact R2 object
- five old passwords, access tokens, refresh tokens, and freshly cloned
  one-use official profiles rejected after the forward-generation restart
- all eight forward-recovery checks and all six aggregate recovery checks
  passed
- final concurrent responses were one 200 and one 401; the earlier successful
  run produced one 200 and one 409. Both loser statuses are accepted because
  the stale request may observe either the committed stamp change or the
  in-flight revision conflict, while exactly one mutation commits.
- command exit 0, run root independently confirmed absent, and no residual
  Wrangler, workerd, or forward-recovery process

## Quality And Cleanup Readback

- focused route, lifecycle, fixture, documentation, and contract matrix:
  409 tests across 9 files
- full suite: 1,331 tests across 101 files
- compatibility fixture replay: 105 tests
- rejected CLI option values are not reflected to stderr; secret-safe packet
  validation remains mandatory before output
- typecheck, ESLint, Prettier, brand scan, release gate 11/11, frozen-lockfile
  install, and `git diff --check`: passed
- dependency audit at `--audit-level low`: zero known advisories
- `sharp 0.34.5` advisory remediation: temporary workspace override to
  `sharp 0.35.3`; lockfile SHA-256
  `bf56db979676ada307ab2fcd0c36e2f480ecbb4fdfdee10e2ab009280e2d701d`
- real local password-change Wrangler D1/R2 lifecycle after the override:
  15/15 checks passed
- managed official-client harness cleanup: root absent and clipboard cleared
- retained secret files: 0; residual Wrangler, workerd, or recovery runner
  processes: 0

## Current Gate

The final integrated proof and complete local quality matrix pass. Remaining
gates are exact-head standard and five-axis review, PR publication and head CI,
squash tree equality, merged-main CI, and HON-226 Done/archive. No tracked
writer may be enabled by this packet.
