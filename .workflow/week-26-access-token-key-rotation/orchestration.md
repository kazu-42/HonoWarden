# Orchestration

1. Confirm the domain token primitive supports keyed signing and verification.
2. Add app-level env parsing with fail-closed semantics for partial or malformed
   keyring config.
3. Keep `HONOWARDEN_TOKEN_SECRET` as refresh-token hash secret and legacy
   no-kid verifier.
4. Add app tests for active signing, previous-key verification, legacy fallback,
   and config failure.
5. Update operator docs, security docs, and release docs.
6. Run focused checks, then full checks.
7. Open PR, wait for CI, merge, and update Linear `HON-45`.

No live secret rotation, deploy, or production mutation belongs to this packet.
