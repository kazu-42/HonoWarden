# Packet 03: route and projections

Objective: expose the KDF endpoint and consistently return stored KDF data.

Ownership: `src/app.ts`, `src/domain/prelogin.ts`, and route/projection tests.

Do: mirror existing credential proof defenses, notification preflight, session
cleanup, and audit behavior; preserve enumeration resistance with an
email-stable, secret-keyed unknown-user KDF derivation spanning every accepted
PBKDF2 and Argon2id parameter tuple.

Do not: silently map unknown stored algorithms to PBKDF2 or mutate before all
preconditions pass.

Verification: focused app/prelogin tests plus a real local D1 lifecycle.
