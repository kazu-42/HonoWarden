# CLIENT-2: Single-Account Credential Lifecycle

## Deliverables

- One real local migrated D1/R2 account and encrypted item generation.
- Account-key initialization/read, password verification/change,
  PBKDF2/Argon2id round trip, and complete user-key rotation.
- Fresh official-client login/unlock/sync/decrypt after each generation.
- Old password/token/session/profile/wrapped-generation rejection.
- Worker and official-client restart evidence with deterministic cleanup.

## Exit Gate

One redacted report proves every stage on the same account. Separate lifecycle
scripts or API projection checks alone do not satisfy this packet.
