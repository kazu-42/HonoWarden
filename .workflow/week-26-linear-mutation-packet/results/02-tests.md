Result: completed

Implemented `test/ops/linear-mutation-packet.test.ts`.

Covered behavior:

- Missing apply-plan path.
- Blocked apply-plan input.
- Ready apply-plan classification.
- Strict-mode failure for blocked packets.
- No-network and no-credential-leak behavior.

Verification:

- `pnpm exec vitest run test/ops/linear-mutation-packet.test.ts`
