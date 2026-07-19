# Packet 03: Config And Security Docs

## Objective

Expose policy inputs without activating functionality and document safe operator
configuration, threats, rollout, recovery, and rollback.

## Ownership

- `src/bindings.ts`
- `.env.example`
- `wrangler.jsonc`
- `docs/operations/operator-environment.md`
- `docs/security/webauthn-threat-model.md`
- focused config/docs tests

## Verification

All tracked environments remain false, environment-specific trust roots remain
blank/untracked, and tests prove no WebAuthn route or capability advertisement.
