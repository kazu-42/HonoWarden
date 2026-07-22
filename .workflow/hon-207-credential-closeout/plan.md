# HON-207 Official-Client Credential Closeout

## Goal

Close the existing-account credential program on one reviewed source
generation by proving that pinned official clients can create, persist, unlock,
and read one cryptographically consistent account across password, KDF,
account-key, and user-key mutations.

## Completion Contract

- One synthetic account starts with a PBKDF2 master-password generation and
  real official-client-compatible wrapped user/account/vault data.
- The same account completes password verification/change, PBKDF2-to-Argon2id
  and Argon2id-to-PBKDF2 changes, account-key initialization/read, and complete
  user-key rotation.
- An unmodified pinned official CLI performs isolated login, unlock, sync, and
  encrypted-item readback before and after credential generations. A pinned
  browser extension performs a final clean-profile login and vault readback
  only if the isolated Chrome for Testing lane remains resource-safe.
- Old passwords, access tokens, refresh tokens, client profiles, wrapped keys,
  and vault generations fail after their owning mutation. Worker and client
  restarts do not weaken the rejection.
- A post-generation backup restores into a fresh local target without reviving
  an older credential/session generation. Feature disable changes route
  availability only; recovery is a newly authenticated forward mutation.
- Compatibility evidence states the precise level for each claim and never
  promotes API-only, fixture-only, local synthetic, staging, or production
  evidence into another level.

## Pinned Sources

- HonoWarden base:
  `a68ec0ccf0c5379ce228dce93f4f8eef05f6d6f3`.
- Upstream server:
  `v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Upstream Web client:
  `web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1`.
- Upstream browser extension:
  `browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2`.
- Upstream CLI:
  `cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0`.
- CLI npm-build asset SHA-256:
  `31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660`.
- CLI macOS arm64 asset SHA-256:
  `57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4`.
- Browser extension asset SHA-256:
  `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e`.

## Evidence Levels

1. `fixture`: recorded wire examples and route replay only.
2. `local_api`: HonoWarden route/repository/real-D1 lifecycle without an
   official client.
3. `local_official_client`: a pinned release asset performs the claimed
   client operation against isolated local synthetic state.
4. `staging`: a pinned official client performs the operation against the
   tracked staging deployment.
5. `production`: a separately approved real production operation.

HON-207 may add `local_official_client` evidence. It does not authorize or
imply staging or production activation.

## Work Packets

1. `CLIENT-1`: pin official assets and build a redaction-safe client-crypto
   harness that stores generated credentials only under ignored temporary
   directories.
2. `CLIENT-2`: execute the complete single-account credential-generation
   lifecycle with real local D1/R2 and isolated official-client profiles.
3. `RECOVERY-1`: prove post-generation backup/fresh-target restore,
   default-off behavior, stale-generation rejection, and one forward recovery.
4. `EVIDENCE-1`: reconcile compatibility levels, current state, security,
   audit/retention, backup/restore, and operator recovery documents.
5. `CLOSE-1`: run full gates and independent review, publish/merge one exact
   head, close/archive the hierarchy, and close HON-160 only after main
   readback.

`RECOVERY-1` is an integration parent, not one implementation-sized change.
It is serialized into three reviewable subpackets:

1. `RECOVERY-1A`: bind a local backup to the approved final credential
   generation and reject manifest or generation drift before restore commands
   execute.
2. `RECOVERY-1B`: restore that exact backup into owned fresh persistence,
   compare D1/R2 contents, reject stale credentials and sessions, and complete
   current official-client decrypt readback.
3. `RECOVERY-1C`: make all credential writers explicitly default-off against
   the same restored state, prove disabled requests are D1-free no-ops, then
   complete exactly one forward credential generation.

Each subpacket has its own focused tests, PR/head CI, exact-head reviews,
merged-main CI, and Linear closeout. `RECOVERY-1` closes only after all three
subpackets and the integrated recovery run pass.

`EVIDENCE-1` is also an integration parent. It is serialized into three
reviewable subpackets so the machine contract is stable before packet generation
and documentation reconciliation:

1. `EVIDENCE-1A`: define the closed evidence-level model and a canonical claim
   registry that binds every credential operation to exact source generations,
   tracked artifacts, official-client pins, and limitations.
2. `EVIDENCE-1B`: generate one deterministic credential-closeout packet and
   reject secret-bearing, stale, untracked, non-regular, or path-escaping
   evidence inputs.
3. `EVIDENCE-1C`: reconcile compatibility, current-state, security,
   audit/retention, backup/restore, rollback, operator, release, and review
   indexes against the canonical packet.

Each evidence subpacket has its own focused tests, PR/head CI, exact-head
reviews, merged-main CI, and Linear closeout. `EVIDENCE-1` closes only after all
three subpackets agree on the same conservative registry and packet.

## Design Decisions

- Official release assets are downloaded by exact tag, size, and SHA-256.
  Network retrieval and derived profiles are ignored runtime state; no
  downloaded client bundle is committed.
- The public official CLI remains unmodified for login, unlock, sync, item
  readback, and process restart. If a deterministic test bridge is required to
  invoke bundled crypto not exposed as a CLI command, the bridge is generated
  under ignored storage, its source asset hash is rechecked, and the evidence
  labels the bridge honestly.
- Synthetic plaintext passwords and decrypted item data exist only in child
  process environment/memory or mode-0700 ignored storage. Reports contain
  statuses, versions, counts, route names, and cryptographic digests only.
- Normal Brave and user profiles are out of bounds. Optional extension
  evidence uses an isolated Chrome for Testing executable, fresh user-data
  directory, dedicated ports, bounded process groups, and deterministic
  cleanup.
- The credential sequence is serialized. A later stage may begin only after
  exact D1 state and an isolated client have accepted the new generation and
  rejected the old one.
- Operational restore consumes the exact post-generation manifest in a fresh
  target. A historical backup is never treated as credential rollback.
  Recovery from credential compromise is a new forward generation.

## Failure Modes And Controls

- A test-only placeholder ciphertext could pass API projections but fail
  client decryption. The lifecycle therefore requires an official-client
  decrypt/read assertion for the same stored item.
- A client can retain a stale local user key after server commit. Each
  generation uses a fresh client process/profile, and stale profiles must fail
  sync or unlock before cleanup.
- Backup restore can be confused with credential rollback. The harness pins
  the exact post-generation manifest/dump digest and rejects a mismatched
  restore source.
- Feature-disable verification can accidentally use a different database.
  Enabled and disabled Workers must bind the same restored local persistence
  path, and byte-level D1/R2 state readback must remain equivalent.
- Browser automation can destabilize the workstation. The extension lane has
  explicit process/FD/disk preflight and may not use the normal Brave profile.
- Evidence can leak secrets through command output. Child stdout/stderr is
  captured and redacted; committed reports must pass synthetic-secret scans.

## Rollback And Recovery

- Before runtime activation, rollback is source revert or feature disable.
- A committed password, KDF, key, or security-stamp generation is never
  restored backward.
- A failed D1 statement rolls back its transaction. A post-commit notification
  cleanup failure remains observable and forward-only.
- Backup restore is disaster recovery from an approved manifest, followed by
  stale-generation rejection and, when required, a new forward credential
  rotation.

## Verification

- Deterministic plan/unit tests and exact Linear apply/readback.
- Official tag/asset provenance, digest, manifest, and version checks.
- Focused red/green tests for client bridge, lifecycle orchestration, secret
  redaction, stale generation, restore mismatch, disable state equality, and
  process cleanup.
- Real local Wrangler, migrated D1, R2 sentinel, backup export/import, Worker
  restart, and isolated official-client runs.
- Full tests, compatibility tests, typecheck, lint, format, dependency audit,
  brand scan, strict release gate, and `git diff --check`.
- Exact-head standard review plus independent five-axis review, PR CI, zero
  unresolved threads, squash tree equality, merged-main CI, Linear
  Done/archive with `trash:false`, and worktree cleanup.

## Exclusions

No deployment, remote D1/R2 mutation, production feature activation, real-user
credential mutation, real secret rotation, destructive data operation, paid
service, third-party contact, Web Vault publication, or compatibility claim
above `local_official_client` is authorized by this plan.
