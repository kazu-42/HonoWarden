# Result 02: Verification

## Focused Checks

- `pnpm exec vitest run test/ops/operator-environment.test.ts test/ops/email-preflight.test.ts test/ops/ops-readiness-packet.test.ts test/release-docs.test.ts`
- `direnv exec . pnpm email:preflight -- --strict`
- `direnv exec . pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`

## Broad Checks

- `pnpm check`
- `pnpm lint`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `pnpm format`
- `git diff --check`
- workflow verifier

## Notes

The strict email preflight exits non-zero by design until a Cloudflare API token
is configured. Treat that as `passed_with_expected_not_ready` only when the sole
failed check is `cloudflare_api_token`.
