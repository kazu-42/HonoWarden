# HON-205 account keypair lifecycle

## Goal

Deliver the default-off AUTH-2D source slice for authenticated account-key
reads and one-time V1 public/wrapped-private key initialization without adding
any replacement path or exposing unwrapped key material.

## Success Criteria

- `GET /api/accounts/keys` returns the pinned legacy and nested response
  envelope only for a complete keypair owned by the authenticated active user.
- `POST /api/accounts/keys` accepts one complete bounded legacy keypair,
  rejects partial/ambiguous/V2 input before D1, and treats an exact replay as a
  successful no-op while rejecting any different replacement.
- The existing bootstrap writer persists only a missing pair or a complete pair
  with its wrapped user key; it cannot create a state rejected by projections.
- First initialization advances only account revision, preserves the security
  stamp and all existing sessions, and commits one redacted required audit
  event atomically with the keypair.
- Profile, password token, refresh token, and sync all project the same complete
  keypair; partial stored state is never returned by any touched projection,
  and profile/export side effects occur only after projection validation.
- Fake-D1 and real local D1 tests prove rollback, stale-write, cross-user,
  disabled-user, idempotency, session-preservation, and audit invariants.
- Focused and full repository gates, pinned-client synthetic evidence,
  standard review, five-axis review, PR/head CI, merge/main CI, and exact Linear
  readback pass before HON-205 becomes Done.

## Current Context

- Base: `main@50a3fabb059f45f1f26b06571faf8339cccc7f21` after HON-204.
- Linear: HON-205 is In Progress, unblocked, and blocks HON-206 and HON-207.
- Compatibility pins: upstream server
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0` and clients
  `39f07436ca60e3f25eac47777671754f288a98f1`.
- The schema already has nullable `users.public_key` and `users.private_key`;
  no migration is expected.
- Existing token/profile/sync helpers already expose complete account-key
  metadata and are the projection baseline to harden.

## Constraints

- The Worker stores only opaque public and wrapped-private values. It never
  parses cryptography, accepts plaintext private keys, or logs either value.
- V2 signature keys, security state, signed public keys, TDE, Key Connector,
  and true key replacement remain unsupported and state-free.
- Both routes remain behind a new exact-true, non-secret, tracked default-off
  flag in every environment.
- Disabled GET/POST and Hono's derived HEAD read bypass the optional global
  request-quota middleware so the default-off and rollback path remains an
  unconditional D1-free 501.
- No production deployment, remote D1 mutation, real-account change, secret
  rotation, compatibility promotion, paid action, or third-party contact.
- HON-161 owns migration number `0015`; this slice must remain migration-free.

## Risks

- A loose parser could silently accept a future V2 envelope and persist only
  part of a cryptographic generation.
- A read-then-write implementation could permit concurrent replacement unless
  D1 guards the exact null/revision/stamp generation.
- D1 trigger side effects make `meta.changes` unsuitable for deciding whether
  one user row changed; the mutation must use `UPDATE ... RETURNING id`.
- Rotating the security stamp for one-time key bootstrap would invalidate the
  token needed by the client to complete initialization; preserving sessions
  must be tested, not inferred.
- Existing corrupt partial rows must fail explicitly and must not leak the
  surviving half through legacy projections; broad route catches must emit one
  redacted incident signal before returning their generic 503.
- Backup failure audit must preserve the typed bounded projection-corruption
  reason instead of classifying a healthy-D1 data-integrity failure as an outage.
- Global middleware ordering must not let an opt-in quota mutate D1 or override
  the disabled account-key route response.
- Projection validation must precede profile mutations and backup success audit
  persistence so a failed response cannot leave a committed success side effect.

## Approval Required

No additional approval is required for local source, tests, a reviewed PR,
admin merge after green gates, Linear closeout, or dedicated-worktree cleanup.
Production activation or mutation remains a separate approval gate and is out
of scope.

## Work Packets

1. Pin the official V1 request/response contract and write the account-key
   state/parser tests.
2. Implement and test the guarded D1 initialization plus atomic audit and
   explicit idempotent/conflict outcomes.
3. Implement default-off GET/POST routes and harden token/profile/sync
   projections through one shared complete-state builder.
4. Prove the lifecycle in real local D1 and a pinned synthetic client, update
   operator/security/compatibility docs, then run full verification and two
   independent review gates.

## Integration Policy

- Keep the API, domain, repository, projection, and evidence changes in one PR
  because they define one atomic security contract.
- Accept only packet results that preserve the no-replacement invariant and do
  not broaden V2 or production claims.
- Fix every actionable standard-review finding and every P1/P2/P3 five-axis
  finding before merge; rerun exact-head reviews after evidence-only changes.

## Verification

- Narrow: domain parser/state tests and credential-repository tests.
- Route: focused app tests for flag/auth/input/state/concurrency/projection
  behavior, including redacted logs and unchanged sessions.
- Real D1: initialize/read/replay/conflict/rollback/restart readback against all
  local migrations.
- Compatibility: pinned request/response fixture or tracked synthetic client
  lifecycle without claiming staging or production evidence.
- Broad: `pnpm check`, full tests, compatibility suite, lint, format, brand
  scan, release gate, Cloudflare typegen diff, workflow verifier, and diff
  check.
- External: standard review, separate five-axis review, PR checks, review
  threads, squash merge, exact-main CI, Linear Done/archive, and queue advance.

## Reusable Artifacts

- Strict account-key request/state parser and tests.
- Migration-free D1 one-time-initialization pattern using `RETURNING` plus
  atomic audit.
- Real local D1 lifecycle script suitable for AUTH-2F composition.
- Byte-exact Linear planning and merge-closeout checkpoints.
