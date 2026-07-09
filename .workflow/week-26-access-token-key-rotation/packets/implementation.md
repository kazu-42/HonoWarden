# Packet: Implementation

Objective: implement staged access-token key-id rotation support with minimal
blast radius.

Files:

- `src/domain/tokens.ts`
- `src/app.ts`
- `src/bindings.ts`
- `test/domain/tokens.test.ts`
- `test/app.test.ts`
- docs and workflow evidence files

Decisions:

- preserve legacy string-based `signAccessToken` and `verifyAccessToken` callers
- add typed signer/verifier objects for keyed access-token use
- use `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID`,
  `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET`, and
  `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`
- reject unknown `kid` without legacy fallback
- fail closed on partial active-key config, malformed previous-key JSON, or
  duplicate key ids

Out of scope:

- rotating `HONOWARDEN_TOKEN_SECRET`
- live Wrangler secret writes
- asymmetric signing or JWKS publication
