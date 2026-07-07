Packet ID: 02-tests

Objective: Prove the operations readiness packet is conservative and read-only.

Context: Tests should model release state with fake `git` and `gh` binaries,
matching the existing release packet test pattern.

Files / sources:

- `test/ops/ops-readiness-packet.test.ts`
- `test/release-docs.test.ts`

Do:

- Cover draft-ready release state.
- Cover email local input readiness without secret leakage.
- Cover strict ready state only when release, email inputs, and all live ops
  evidence files are present.
- Keep release docs pointing at the packet.

Do not:

- Use real GitHub, Cloudflare, DNS, or email writes.
- Treat local email input presence as live Email Routing proof.

Expected output: focused tests fail on overly broad readiness claims.

Verification: `pnpm exec vitest run test/ops/ops-readiness-packet.test.ts
test/release-docs.test.ts test/ops/email-preflight.test.ts
test/ops/release-completion-audit.test.ts`.
