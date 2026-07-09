# Packet 03: Review and PR

## Objective

Verify, review, publish, and merge the request-plan slice.

## Required Checks

- targeted request-plan tests
- targeted mutation-packet plus request-plan tests
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- blocked and ready smoke tests
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
