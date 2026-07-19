# Standard review

Initial reviewed commit: `7f8c4d4c0ec7329ed44fc814001ae25a2b94dc55`

Second reviewed commit: `f32f1f71d1d6ce9761326ac35c44c10b91270495`

Third reviewed commit: `784a18f9cd5c442c6044104999768b0405779931`

Fourth reviewed commit: `7ce78bc6d7b6539a6793873e996d92b9666ec983`

Fifth reviewed commit: `74b44cc50b1ba5f8b0bdfd9fbcc59e88b8a68e72`

Sixth reviewed commit: `b4c23ffca35a2d7b7d936654fc69ad41a4539750`

Seventh reviewed commit: `23a383863dc0baf2c39475690cecf523a4e84561`

Status: five-axis P3 remediation complete in the working tree; both exact-head
reviews must rerun after commit

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

## Third Review Finding

- P2: the six-entry synthetic KDF pool could never return an accepted tuple
  outside those presets. A known account using PBKDF2 `700000`, for example,
  was therefore distinguishable from every unknown allowlisted address despite
  the secret-keyed HMAC selection.

## Third Remediation

- replaced finite preset selection with a domain-versioned HMAC derivation over
  the complete accepted PBKDF2 and Argon2id parameter ranges
- kept algorithm choice and every parameter deterministic for one normalized
  email and secret while making every accepted tuple a plausible decoy
- added fixed non-preset PBKDF2 and Argon2id vectors plus sampled policy-bound
  coverage
- regenerated tracked Wrangler bindings so the default-off rollout variable is
  represented in generated environment types

Focused verification passes 3 files and 309 tests; full verification passes 86
files and 1,041 tests, 101 compatibility tests, the 17-check local D1 lifecycle,
typecheck, lint, format, type generation, release gate, brand scan, diff check,
and workflow verification. Clean standard plus five-axis reviews must run on
the resulting exact commit.

## Fourth Review Findings

- P2: accepted legacy PBKDF2 generations were excluded from the synthesized
  decoy range. A known readable `100000` generation was therefore immediately
  distinguishable from every unknown allowlisted address.
- P2: uniform synthesis did not match the real account population. A common
  bootstrap PBKDF2 `600000` generation had only a negligible probability for
  an unknown address, preserving a practical existence signal.
- P2: uniform synthesis emitted high-cost Argon2id validation-boundary decoys,
  including profiles up to 1024 MiB, 10 iterations, and parallelism 16, even
  when no account stored such a profile.

## Fourth Remediation

- replaced validation-range synthesis with one read-only D1 CTE that returns
  the exact target and the complete grouped stored KDF population in the same
  snapshot
- select unknown decoys with a domain-versioned HMAC weighted by stored account
  count, so readable legacy tuples and real default-heavy frequencies are
  represented
- emit only resource profiles that are already stored; use PBKDF2 `600000` only
  as the empty-database bootstrap fallback
- fail closed for malformed distribution rows or an exact target absent from
  its own population, while always returning the exact validated target for a
  known account
- added focused domain, repository, route, FakeD1, and real local D1 lifecycle
  evidence, including the unknown response tracking a one-account population
  across PBKDF2-to-Argon2id mutation

The fourth-remediation combined focused suite passes 4 files and 312 tests, the
full suite passes 86 files and 1,045 tests, compatibility passes 101 tests, and
the standalone local D1 lifecycle passes all 18 checks. Typecheck, lint,
format, type generation, release gate, brand scan, diff check, and workflow
verification also pass. Both independent reviews must rerun on the committed
exact head before merge approval.

## Fifth Review Finding

- P1: post-commit Durable Object invalidation failure returned HTTP 503 after D1
  had already committed the new KDF generation. The pinned client updates its
  local master key, unlock data, wrapped user key, and KDF only after the request
  succeeds, so this response left the client on the revoked generation.

## Fifth Remediation

- preserve the pre-mutation notification binding check, but acknowledge HTTP 200
  after an irreversible D1 commit even when notification transport fails
- retain the redacted `account_notification_session_invalidation_failed` error
  signal for operational recovery
- isolate malformed or client-unreadable unrelated KDF rows from the prelogin
  population while retaining fail-closed validation for an invalid exact target
- use an anchor row so target data and an empty valid population remain one D1
  snapshot; fall back to PBKDF2 `600000` only for unknown accounts with no valid
  stored population

Focused TDD failed on the five new regression conditions and then passed 3 files
and 314 tests. The combined focused suite passes 4 files and 315 tests, the full
suite passes 86 files and 1,048 tests, compatibility passes 101 tests, and the
standalone real local D1 lifecycle passes all 18 checks. Typecheck, lint, format,
type generation, release gate, brand scan, diff check, and workflow verification
also pass. Both exact-head reviews must rerun on the committed remediation.

## Sixth Review Finding

- P1: after D1 committed the irreversible KDF generation, the route still
  synchronously awaited Durable Object invalidation. A slow or permanently
  pending object therefore prevented the 200 acknowledgement the pinned client
  needs before storing its matching local KDF, recreating the same split-
  generation failure as an explicit transport error.

## Sixth Remediation

- schedule KDF notification cleanup through the Worker execution context's
  `waitUntil` instead of awaiting it on the response path
- preserve the pre-mutation binding check and the existing synchronous
  password/security-stamp cleanup contracts
- keep redacted background failure logging without exposing user, KDF, hash,
  token, or wrapped-key data
- add a deferred Durable Object regression proving HTTP 200 settles before the
  cleanup promise, plus retain the explicit rejection regression

Focused TDD reproduced the stall before the cleanup promise was released and
then passed. The combined credential/repository/app suite passes 5 files and
378 tests, the full suite passes 86 files and 1,049 tests, and the standalone
real local D1 lifecycle passes all 18 checks. Compatibility passes 101 tests;
typecheck, lint, format, type generation, release gate, brand scan, diff check,
and workflow verification also pass. Both exact-head reviews must rerun on the
committed remediation.

## Seventh Review Result

The standard exact-head review of `23a3838` reported no actionable correctness
defect. A separate five-axis review found one P3 operational defect: if the
Durable Object fetch never settled, the `waitUntil` promise also never settled.
The platform could cancel it at its lifetime boundary before the application
emitted `account_notification_session_invalidation_failed`, leaving no
request-correlated failure evidence.

## Seventh Remediation

- bound Durable Object session invalidation to an application-owned 10-second
  deadline below the execution-context lifetime boundary
- abort the same outbound `Request` when the deadline expires and settle the
  cleanup result deterministically
- preserve the existing redacted failure event and request ID without logging
  account, credential, token, or KDF material
- add a never-settling transport regression proving immediate KDF HTTP 200,
  deadline settlement, request abort, and exact structured logging
- apply the bound in the shared helper so password and security-stamp cleanup
  cannot hang indefinitely while retaining their existing 503-on-incomplete
  contracts

The focused regression failed before the implementation and passed afterward;
the full app suite passes all 271 tests. Broad verification and both exact-head
reviews remain required on the committed remediation.
