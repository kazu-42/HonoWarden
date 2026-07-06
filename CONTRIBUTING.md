# Contributing

Thanks for considering a contribution to HonoWarden.

This project handles password-vault sync, so changes should be small, reviewable, and covered by tests.

## Development Flow

1. Open an issue or draft PR before large compatibility, crypto, storage, or migration changes.
2. Add or update tests before changing behavior.
3. Run the full local check suite before opening a PR:

   ```sh
   pnpm check
   pnpm lint
   pnpm test
   pnpm format
   ```

4. Keep PRs focused on one behavior change.
5. Document compatibility decisions in `docs/compatibility.md` or a new ADR when the change affects project scope.

## Compatibility Changes

For upstream client compatibility work, include:

- the client and version used for observation
- the endpoint or flow being implemented
- expected request and response shapes, with secrets removed
- unsupported cases and their error behavior

## Security-Sensitive Changes

Security-sensitive changes include authentication, token handling, encryption boundaries, database migrations, attachment storage, and request validation.

These changes require tests for expected behavior and failure modes. Do not include real credentials, tokens, vault exports, or production data in issues, PRs, fixtures, or logs.
