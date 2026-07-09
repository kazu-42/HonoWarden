# Packet 03: Review and PR

## Objective

Verify, review, publish, and merge the resolution-plan slice.

## Required Checks

- targeted resolution-plan tests
- targeted request-plan plus resolution-plan tests
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- missing-map and ready-map smokes
- workflow verifier
- `git diff --check`
- target-file secret scan
- `codex review --uncommitted`

## PR Rules

- Stage only intended files.
- Use a terse commit message.
- Create PR against `main`.
- Wait for CI.
- Merge with `--admin` only after CI and local review are clean.
- Update `HANDOFF.local`; do not commit it.
