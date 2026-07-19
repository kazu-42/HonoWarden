# HON-204 KDF mutation plan

## Goal

Add an existing-account KDF mutation lifecycle that changes a credential
generation between PBKDF2-SHA256 and Argon2id without accepting an
undecryptable generation.

## Success criteria

- `POST /api/accounts/kdf` proves the old authentication hash and accepts
  matching authentication/unlock data for one new KDF generation.
- The account salt remains the normalized email and both representations use
  the same new KDF.
- Inclusive KDF bounds match the pinned server/client intersection.
- Hash, wrapped user key, KDF fields, security stamp, revision, session
  revocation, auth-request invalidation, and audit event commit atomically.
- Prelogin, password/refresh responses, profile, and sync project the stored KDF
  consistently. Unknown stored algorithms fail closed, while unknown allowed
  accounts receive a secret-keyed client-valid decoy without a fixed existence
  signal.
- Prelogin reads a transactionally maintained KDF population summary rather
  than aggregating all account rows per request.
- Boundary, drift, stale generation, rollback, enumeration resistance, and
  old/new session behavior have focused tests and a real local D1 lifecycle.
- KDF readers ship independently of a default-off writer so the first deploy is
  a reader-capable rollback target before any Argon2id generation can commit.
- Full repository checks and two independent exact-head reviews pass before PR.

## Constraints

- Never receive or log a plaintext master password or an unwrapped user key.
- No production mutation, real-user fixture, deploy, or secret rotation.
- Keep `HONOWARDEN_KDF_MUTATION_ENABLED=false` in tracked environments; local
  lifecycle evidence may opt in explicitly without activating a deployment.
- Reuse the existing guarded credential-generation transaction and proof
  defense rather than adding a second mutation model.
- Keep the pinned upstream server/client commits immutable in evidence.

## Work packets

1. Pin and verify the official request, validation, mutation, and client
   derivation contract.
2. Add domain parsing/bounds and atomic repository mutation with focused TDD.
3. Add route integration and all stored-KDF projections with lifecycle tests.
4. Run local D1 and full checks, then standard and five-axis exact-head reviews.

## Integration policy

Each packet must preserve the single-generation invariant. A stale guard or any
D1 statement failure leaves credentials, sessions, auth requests, and audit
state unchanged. Projection helpers reject unknown database values instead of
silently treating them as PBKDF2.

## Verification

- Focused domain, repository, prelogin, and app tests.
- Real local D1 migration and synthetic KDF round-trip lifecycle.
- Typecheck, lint, format check, full tests, compatibility suite, release gate,
  and brand scan.
- Standard findings-first review followed by a separate five-axis review on the
  exact candidate head.
