# Packet 03 result: default-off route and generation consistency

## Status

Completed on the HON-206 branch. The pinned V1 route is implemented behind a
false default in development, staging, and production. This packet does not
deploy, enable a remote flag, mutate remote D1/R2, rotate a real credential, or
promote the fixture to official-client compatibility.

## Route contract

- Disabled POST and Hono-derived HEAD bypass the optional global request quota
  and return `501 unsupported_feature` without touching D1.
- Enabled POST authenticates the bearer, rejects malformed bounded input and
  incomplete account keys, preflights the notification binding, then applies
  the existing credential-proof defense to the old client-derived hash before
  any snapshot or mutation query. Malformed input and known configuration
  failure do not consume password-failure state.
- The route rejects an oversized `Content-Length` immediately and enforces the
  same 2 MB limit while reading chunked raw bytes, before JSON parsing or
  credential-proof state is touched.
- The route verifies unchanged KDF/email salt/public key generation data and
  invokes `rotateUserKeyGeneration` exactly once. It maps malformed/proof,
  stale/conflict, unsupported-state, fixed-budget, and infrastructure results
  to bounded secret-free responses.
- D1 success is acknowledged with an empty 200 before generation-aware Durable
  Object cleanup. Cleanup rejection is incident-logged without turning a
  committed generation into a false failure.
- `account.keys.rotate` is constructed with bounded boolean/version context and
  commits in the repository batch. Hashes, wrapped keys, encrypted payloads,
  manifests, tokens, and R2 identifiers never enter route logs.

## Generation consistency

- A password-grant session created before rotation is revoked by the same
  transaction. Its old access token fails the security-stamp check, its refresh
  token fails after D1 revocation, and its old password hash no longer grants a
  session.
- A new password grant returns the new wrapped user/private generation. The new
  access token reads the same complete generation from profile, sync, and
  backup export, with empty supported vault projections in the pinned fixture.
- The route receives no R2 binding and cannot change object keys or bytes. Real
  populated-vault, R2-sentinel, restart, abort, and concurrency evidence remains
  Packet 04's lifecycle gate.

## TDD and verification

- Red: the first session-lifecycle expansion exposed that the route-test D1
  double did not persist auth-failure buckets and then conflated refresh-session
  invalidation with the ten-statement key-rotation batch. The double now models
  those contracts separately; production source was unchanged by that fix.
- Focused domain/repository/real-D1/route/config/policy/lifecycle gate: 8 files
  and 82 tests pass.
- Route suite: 13/13 tests pass, including disabled D1-free behavior, ordering,
  every result class, fixture replay, post-commit cleanup failure, old
  generation rejection, and new projection consistency.
- Full suite: 96 files and 1,167 tests pass.
- `pnpm check`, full `pnpm lint`, full `pnpm format`, and `git diff --check`
  pass.

## Packet 04 handoff

Packet 04 must run an actual local Wrangler/D1 lifecycle with populated vault
state and an external R2 sentinel, restart the Worker, prove old/new generation
behavior plus abort/concurrency, publish release evidence, and then run exact-
head standard/five-axis reviews, PR/head CI, merge-tree equality, merged-main
CI, Linear Done/archive, HON-207 advancement, and isolated worktree cleanup.
