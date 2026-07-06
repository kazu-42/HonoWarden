# Spec: Week 16 Dogfood Environment Readiness

## Summary

Week 16 prepares HonoWarden for low-risk dogfood by making runtime environment separation explicit, testable, and visible through operational health responses.

This increment does not claim live dogfood success. It creates the guardrails needed before staging and production are used with client-managed low-risk entries.

## Inputs

- `HONOWARDEN_ENV`
- `wrangler.jsonc`
- `GET /health`
- `GET /healthz`
- `docs/dogfood-runbook.md`

## Outputs

- Health responses include the resolved runtime environment.
- Unknown or missing environment values resolve to `development`.
- CI validates staging and production separation in Wrangler config.
- Dogfood runbook documents staging-first verification, promotion gates, and abort conditions.

## Behavior

1. Runtime environment values are limited to `development`, `staging`, and `production`.
2. Missing, empty, or unknown values fall back to `development`.
3. Health responses expose only the coarse resolved environment, not secrets or storage identifiers.
4. Staging and production Wrangler environments must use distinct worker names, D1 database names, and R2 bucket names.
5. Bootstrap remains disabled by default in staging and production.
6. Dogfood uses only low-risk synthetic entries until live-client evidence is intentionally recorded.

## Edge Cases

- Placeholder Cloudflare resource IDs are allowed before live resource creation, but resource names must remain distinct.
- Development may use local or placeholder bindings.
- Live client success requires a separate evidence capture; local tests do not imply live compatibility.

## Acceptance Criteria

- [x] `GET /health` and `GET /healthz` include `environment`.
- [x] Runtime environment resolution is unit-tested.
- [x] Wrangler staging/production separation is covered by tests.
- [x] Dogfood runbook exists.
- [x] Current state documents readiness and remaining live dogfood work.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
