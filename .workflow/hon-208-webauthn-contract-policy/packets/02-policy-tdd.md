# Packet 02: Policy TDD

## Objective

Implement the pure fail-closed WebAuthn runtime policy from a focused red test.

## Ownership

- `src/domain/webauthn.ts`
- `test/domain/webauthn.test.ts`

## Invariants

- Disabled unless the enabled flag is exactly true after trim/case folding.
- No request-derived values.
- Exact HTTPS origins and RP-label matching only.
- Exact localhost HTTP requires a separate true flag.
- Stable deterministic error codes contain no raw configuration values.

## Verification

Focused domain test must be observed failing before implementation and passing
after implementation.
