# HON-206 atomic user-key rotation

## Goal

Implement the pinned V1 `POST /api/accounts/key-management/rotate-user-account-keys`
flow so one authenticated user can change the master-password generation and
rewrap every supported personal-vault record under a new opaque user key without
partial state, stale sessions, or plaintext cryptography on the server.

## Success Criteria

- Parse the exact pinned V1 client envelope with bounded opaque values and
  reject unknown, ambiguous, duplicate, partial, or V2-only variants.
- Verify the current client-derived authentication hash through the existing
  credential-proof defense before any mutation.
- Require unchanged salt and KDF, unchanged account public key, a newly wrapped
  user key/private key generation, and complete current account-key state.
- Reject non-empty Send, Emergency Access, organization recovery, WebAuthn,
  V2-upgrade, TDE, Key Connector, or organization-owned data before D1 writes.
- Validate the exact active personal folder/cipher/uploaded-attachment/trusted-
  device ID set. Reject foreign, duplicate, missing, deleted, pending-upload,
  stale observable revision, or metadata-changing payloads.
- Commit the user credential generation, personal vault ciphertext, attachment
  metadata, trusted-device wrapped keys, security stamp, account revision,
  D1 session revocation, auth-request supersede, and required audit row in one
  guarded D1 batch.
- Leave R2 object keys and bytes unchanged; rotate only D1 attachment file-name
  and attachment-key ciphertext after proving ownership and exact membership.
- Keep the route default-off in development, staging, and production; disabled
  POST/HEAD must remain D1-free and return the explicit unsupported response.
- Prove abort, concurrent mutation, restart, old-generation rejection, exact
  post-rotation readback, and forward recovery with real local D1 evidence.
- Pass focused, full, compatibility, type, lint, format, release, standard
  review, independent five-axis review, PR/head CI, merge/main CI, and exact
  Linear closeout gates.

## Current Context

- Branch: `feat/hon-206-user-key-rotation` from merged `main` at
  `955a9703dd74ae7a26221fe8ccd4ee875e09fd07`.
- Linear: HON-206 is In Progress and unblocked. It is the AUTH-2E child of
  HON-160 and is the only active blocker of HON-207.
- Pinned server: `v2026.6.1` commit
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Pinned clients: `web-v2026.6.1` commit
  `39f07436ca60e3f25eac47777671754f288a98f1`.
- Existing reusable boundaries: strict credential/KDF parsers, account-key
  classifier, guarded credential-generation batch, session/auth-request
  invalidation, complete-only projections, folders, personal ciphers, uploaded
  attachment metadata, and trusted-device key storage.

## Contract Decisions

- Support the pinned V1 compatibility form only. The public RSA key remains
  unchanged; the private key is rewrapped by the client under the new user key.
- Accept the pinned client's duplicated V1 account-key representation only when
  legacy and `publicKeyEncryptionKeyPair` values are exactly equal and V2
  signature/security fields are null or absent.
- Password/KDF metadata remains one unchanged salt/KDF generation. HON-206 is a
  user-key plus password generation change, not a KDF migration.
- The pinned client sends `lastKnownRevisionDate` for ciphers and attachments
  but no revision for folders. HonoWarden therefore rejects stale cipher and
  attachment payloads directly and guards folders against the exact current
  server snapshot inside the transaction. It does not claim that the pinned
  envelope can prove when a client produced a folder ciphertext.
- Deleted personal ciphers/folders and pending attachments block rotation until
  they are restored, permanently removed, or completed. This avoids making
  undecryptable retained data or changing R2 ownership during credential work.
- Organization ciphers remain outside HON-206. The request must contain only
  personal records and every unsupported product array must be empty.

## D1 Design

- Use a single `D1Database.batch()` because Cloudflare documents batch as a SQL
  transaction that rolls back the full sequence on statement failure.
- Respect the current D1 limits of 50 queries per free-plan Worker invocation,
  100 bound parameters per query, 100 KB SQL per statement, and 30 seconds for
  the complete batch.
- Validate a compact JSON ID/revision manifest in the guarded user update, then
  apply bounded multi-row chunks for folders, ciphers, attachments, and trusted
  devices. Reject requests whose derived statement budget exceeds the reserved
  limit before mutation.
- Every later statement is gated by the new security stamp and revision. A lost
  account-generation race therefore changes zero downstream rows.
- Use `RETURNING id` and exact result-count/readback assertions. Real D1 tests,
  not fake D1 alone, are the atomicity authority.

## Linear Decomposition

HON-206 is large enough to expose four reviewable sub-issues. They remain under
the existing AUTH-2E parent and execute in order:

1. Contract and strict domain parser.
2. Guarded atomic D1 repository mutation.
3. Default-off route, session cleanup, and outward consistency.
4. Real-D1 evidence, reviews, publication, and parent closeout.

The sub-issues describe independently reviewable acceptance packets. The route
stays disabled throughout intermediate source states, and no sub-issue claims
production activation.

## Constraints

- Never log hashes, wrapped keys, cipher/folder payloads, attachment metadata,
  tokens, personal identities, or private provider data.
- No plaintext master password, unwrapped user key, decrypt operation, or
  server-side re-encryption enters the Worker.
- No production deployment, remote D1 mutation, real-account rotation, secret
  rotation, paid action, or third-party contact is authorized by this workflow.
- Do not restore an old hash, user key, security stamp, or session as rollback.
  Recovery is a new forward generation after reauthentication.
- Do not touch unrelated dirty worktrees or any `entire/*` branch.

## Risks

- A false success after a partial D1 write would strand the client between key
  generations. Transaction guards and exact post-batch counts are mandatory.
- A false rejection after commit would make the client retain the old local
  generation. Post-commit Durable Object cleanup must not delay the 200 needed
  for the client to finish its local logout transition.
- Missing one encrypted record makes it permanently unreadable under the new
  user key. Exact set equality is stricter than upstream's one-way lookup.
- Attachment metadata changes without cipher/R2 ownership checks can orphan or
  misassociate objects. Object keys and bytes must remain immutable.
- D1 query/parameter limits can turn large vaults into partial runtime failures.
  Statement budgeting must fail before entering `batch()`.

## Verification

- Domain parser matrix for aliases, unknown fields, bounded strings, V1 dual
  keys, unsupported arrays, duplicate IDs, and stale revision formats.
- Repository unit/fake coverage for exact manifests, every guarded statement,
  zero-change conflicts, result-count invariants, and statement budgets.
- Route tests for feature disable, auth/proof defense, status taxonomy, audit,
  notification scheduling, projections, and old session rejection.
- Real local D1 lifecycle with synthetic users, personal folders/ciphers,
  uploaded attachment metadata and R2 sentinel objects, trusted devices,
  concurrent requests, forced aborts, restart, and exact database readback.
- Pinned client-shaped fixture replay without a compatibility-level promotion.
- Full repository gates, exact-head reviews, GitHub checks and thread readback,
  merge-tree equality, merged-main CI, Linear Done/archive, and cleanup.

## Rollback

Keep `HONOWARDEN_USER_KEY_ROTATION_ENABLED=false`. If source must be rolled
back, disable the route first and deploy the previous compatible reader. Never
write an old credential generation back. Any account already rotated recovers
only through a separately authenticated forward rotation.
