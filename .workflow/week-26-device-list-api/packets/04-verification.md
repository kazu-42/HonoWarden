# Packet 04: Verification

## Objective

Prove the slice is safe to commit and push.

## Checks

- focused repository tests
- focused route tests
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

## Gate

Do not commit until every check passes or the failure is documented as unrelated
and explicitly accepted.
