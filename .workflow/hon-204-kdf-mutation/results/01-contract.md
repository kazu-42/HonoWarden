# Packet 01 result: pinned KDF contract

Verified live through the GitHub content API on 2026-07-19.

- Server revision: `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Client revision: `39f07436ca60e3f25eac47777671754f288a98f1`.
- Request requires an old master-password authentication hash plus new
  authentication and unlock data.
- New authentication and unlock data require equal KDF settings and equal,
  non-empty salts; mutation additionally validates that the salt is unchanged
  for the account.
- PBKDF2-SHA256 iterations are inclusive `600000..2000000`.
- The server's Argon2id bounds are iterations `2..10`, memory `15..1024` MiB,
  and parallelism `1..16`; the pinned client's setting and prelogin validators
  require memory `16..1024` MiB. HonoWarden uses the inclusive intersection
  `2..10`, `16..1024` MiB, and `1..16`.
- The client derives old proof and the complete new credential generation
  locally; the service never needs the plaintext master password.
- The server saves authentication data, unlock data, and KDF configuration as
  one operation and logs out existing clients by default.
- The pinned identity prelogin returns exact stored KDF data for known accounts
  and selects unknown-account PBKDF2/Argon2id decoys with a normalized-email,
  keyed hash. HonoWarden keeps the same domain-separated, email-stable property
  but hardens the selection against local distribution and resource-cost
  signals: one D1 snapshot returns the exact target plus the client-readable
  stored KDF population, and the keyed hash selects an unknown-account decoy
  from that population weighted by account count. This includes readable legacy
  tuples and never synthesizes a validation-maximum resource profile. Unrelated
  invalid rows are excluded; an invalid exact target fails closed; an empty valid
  population falls back to the bootstrap PBKDF2 default.

Primary source paths are already catalogued in
`.workflow/hon-160-account-credential-mutation/results/01-official-contract.md`.
