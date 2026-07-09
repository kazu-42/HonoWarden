# Week 26 Access Token Key Rotation

Goal: close `HON-45` by adding staged access-token signing-key rotation support
without rotating live production secrets.

Success criteria:

- new access tokens can carry a JWT `kid` when active access-token key config is
  present
- active and previous key ids verify during the staged rotation window
- legacy no-kid access tokens remain valid through `HONOWARDEN_TOKEN_SECRET`
  fallback
- partial or malformed keyring config fails closed
- docs explain rollout, rollback, and evidence rules
- focused and full repository checks pass before PR closeout

Constraints:

- do not rotate production secrets in this issue
- do not change refresh-token hash semantics
- do not record secret values, bearer tokens, refresh tokens, or previous-key
  JSON values in evidence

Keyring env names:

- `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID`
- `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET`
- `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`

Verification:

- `pnpm exec vitest run test/domain/tokens.test.ts test/app.test.ts`
- `pnpm exec vitest run test/ops/access-token-key-rotation.test.ts`
- `pnpm check`
- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm release:gate -- --strict`
- `git diff --check`
