# Packet: Implementation

Objective: implement `HON-44` TOTP wrapping-secret rotation tooling.

Files:

- `scripts/honowarden-totp-secret-rotation.mjs`
- `package.json`
- `.env.example`
- `docs/operations/totp-secret-rotation.md`
- security/current-state docs
- `test/ops/totp-secret-rotation.test.ts`

Decisions:

- use local-only `HONOWARDEN_TOTP_OLD_SECRET` and
  `HONOWARDEN_TOTP_NEW_SECRET`
- keep runtime `HONOWARDEN_TOTP_SECRET` writes out of the CLI
- never print plaintext TOTP secrets or encrypted envelopes in the JSON packet
- block rewrap when any active or pending envelope is corrupt
- require `--execute --confirm <database>:<strategy>` before mutation

Out of scope:

- live rotation
- production D1 mutation
- Wrangler secret writes
- user communication automation
