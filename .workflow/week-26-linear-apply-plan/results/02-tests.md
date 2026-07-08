Result: completed

Added `test/ops/linear-apply-plan.test.ts`.

Coverage includes:

- no preflight report produces a blocked local plan
- strict mode exits non-zero when blocked
- blocked preflight reports propagate into apply-plan blocking reasons
- ready preflight reports classify create, confirm-existing, create-or-update,
  and manual-confirm operations
- workspace mismatch, missing workspace readback, seed fingerprint mismatch,
  stale inventory, and missing team id fail closed
- paginated/incomplete preflight inventory fails closed before any create
  classification
- view project dependencies resolve to project operation IDs
- custom seed paths work
- an injected `fetch` hook is not called

Targeted verification passed:

```sh
pnpm exec vitest run test/ops/linear-preflight.test.ts test/ops/linear-apply-plan.test.ts
```
