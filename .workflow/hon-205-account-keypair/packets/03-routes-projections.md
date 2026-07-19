# Packet 03: routes and projections

## Objective

Expose default-off authenticated GET/POST account-key routes and ensure every
touched projection uses the same complete-key state.

## Ownership

- `src/app.ts`
- `src/bindings.ts`
- `.env.example`
- `wrangler.jsonc`
- `worker-configuration.d.ts`
- focused app/environment tests
- `.workflow/hon-205-account-keypair/results/03-routes-projections.md`

## Verification

- Flag, auth, missing/partial/conflict/replay/concurrency, response envelope,
  projection consistency, redaction, and preserved-session tests pass.
