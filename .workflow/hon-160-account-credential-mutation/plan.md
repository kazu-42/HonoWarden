# HON-160 Account Credential Mutation

## Goal

Decompose HON-160 into reviewable account-credential slices, synchronize the
dependency graph to Linear, and deliver the first unblocked foundation slice
without weakening the existing password, TOTP, refresh-token, device-binding,
or end-to-end encryption boundaries.

## Success Criteria

- Pinned official client/server contracts are mapped to HonoWarden routes,
  state, and explicit unsupported boundaries.
- HON-160 has six bounded child issues with exact acceptance criteria and a
  read-back-verified `blocks` graph.
- Existing-account password, KDF, keypair, and user-key changes cannot be
  split into incompatible generations or leave old sessions valid.
- The first child is implemented with focused TDD, host-wide gates, real local
  D1 transaction evidence, clean independent review, and an exact Linear
  source-ready checkpoint.
- No production capability or official-client compatibility level is claimed
  without separately approved deployment and live evidence.

## Current Context

- Base: `main` at `30c361fd4c7bcdd01fab47be77037adec31226a5`.
- Branch/worktree: `feat/hon-160-account-credentials` at
  `/Users/hackhike/dev/HonoWarden-hon-160-account-credentials`.
- HON-160 is Backlog, unblocked, priority 0, and blocks HON-164.
- Existing D1 state already stores password authentication hash, KDF settings,
  wrapped user key, public/private key, security stamp, devices, and hashed
  refresh tokens; no schema migration is required for the foundation child.
- Official contracts are pinned to clients `web-v2026.6.1` commit
  `39f07436ca60e3f25eac47777671754f288a98f1` and server `v2026.6.1`
  commit `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.

## Constraints

- Never receive, store, or log a plaintext master password. The API accepts
  only client-derived authentication hashes and opaque encrypted key material.
- Password changes require unchanged KDF and salt. KDF changes require matching
  authentication/unlock KDF and salt plus bounded PBKDF2 or Argon2id settings.
- Credential state, security stamp, revision, session revocation, and required
  audit evidence must commit or fail together.
- Initial password setting for a passwordless/invite-created account belongs to
  HON-159; unsupported TDE, Key Connector, and organization recovery variants
  remain typed and state-free.
- Keep HON-161 migration `0015` and every unmerged user change intact.
- Every Linear call runs through `direnv exec /Users/hackhike/dev/HonoWarden`.

## Risks

- A user-row-only update can leave refresh tokens valid after a password or KDF
  change even when old access tokens fail through security-stamp comparison.
- Treating PBKDF2 and Argon2id as the same numeric projection can create an
  account that official clients cannot unlock.
- Accepting mismatched authentication/unlock salts or KDF settings can persist
  a valid login hash with an undecryptable wrapped user key.
- Concurrent mutations can overwrite a newer credential generation unless the
  D1 write is guarded by expected security stamp and current password hash.
- Full user-key rotation spans personal folders/ciphers and later product
  surfaces; unsupported non-empty payloads must fail before any write.

## Approval Required

- Already authorized: local worktree changes, tests, read-only official-source
  research, and normal Linear issue/comment/state/relation writes.
- Pending explicit approval: commit, push, GitHub repository/PR/comment/merge,
  and publication closeout.
- Separately gated: deployment, production secrets/users/data, credential
  rotation, destructive deletion, paid services, and third-party contact.

## Work Packets

1. Official contract: map current request models, routes, KDF bounds, and
   security-stamp/session behavior from pinned public source.
2. HonoWarden boundary: map schema, auth helpers, D1 transaction points, audit,
   compatibility projections, and migration collision risks.
3. Test and rollback: define red/green matrix, real local D1 proof, concurrency
   guards, rollback behavior, and client evidence requirements.
4. Linear decomposition: create AUTH-2A through AUTH-2F, relation graph, parent
   execution map, managed checkpoint, and independent exact readback.
5. AUTH-2A delivery: implement the mutation foundation and explicit
   security-stamp rotation route with no external activation.
6. Verification/review: run focused and full gates, inspect source and SQL,
   remediate findings, and synchronize source-ready evidence.

## Integration Policy

Official source defines observable wire behavior, not HonoWarden product
expression or implementation. Existing HonoWarden security invariants win when
upstream behavior is weaker. Child slices may share internal contracts, but no
dependent route is published from an unmerged foundation. Findings are
integrated only after direct source inspection and a focused regression test.

## Verification

- Decomposition: deterministic manifest tests, dry run, canonical apply, direct
  independent GraphQL readback, exact descriptions/states/parents/relations,
  byte count, and SHA-256 checks.
- Foundation: focused domain/repository/app tests, fresh local D1 through the
  latest migration, transaction-abort proof, concurrency proof, full `pnpm
test`, `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm brand:scan`, strict
  release gate, and `git diff --check`.
- Review: fresh independent diff review after all fixes. Sandbox-only failures
  never substitute for a passing host run.

## Reusable Artifacts

This workflow directory retains the source pins, issue manifest, deterministic
Linear synchronizer, exact readbacks, verification evidence, and residual-risk
handoff. It must not contain credentials, real identities, raw client profiles,
or private vault data.
