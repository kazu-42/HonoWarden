# Spec: Week 03 Compatibility Fixture Harness

## Summary

Week 03 introduces a fixture harness for the upstream client protocol shapes that HonoWarden must preserve. This increment does not implement authentication or sync yet; it makes the expected JSON contracts executable in CI.

## Inputs

- `compat/fixtures/**/*.json`: protocol fixture definitions.
- `pnpm compat:test`: fixture validation command.

## Outputs

- A passing compatibility fixture suite.
- Fixture examples for:
  - password prelogin KDF discovery
  - password grant token success
  - empty personal vault sync

## Behavior

1. Every fixture declares a stable name, endpoint method, endpoint path, expected response status, expected response body, and assertions.
2. Assertions validate required JSON paths, expected primitive types, and exact sentinel values where stability matters.
3. The harness fails if a fixture is malformed or if a required path is absent.
4. Fixtures use synthetic encrypted placeholders only; they must not contain real credentials, vault exports, or live tokens.
5. Fixture names and file paths use generic upstream-protocol terminology.

## Edge Cases

- Unknown extra response fields are allowed, because official clients may tolerate or introduce fields over time.
- Missing required fields fail the suite immediately.
- Nullable optional fields must be represented explicitly when current client models require a stable key.

## Acceptance Criteria

- [x] `compat/fixtures` contains prelogin, token, and empty sync examples.
- [x] `test/compat/compat-fixtures.test.ts` validates fixture structure and response assertions.
- [x] `pnpm compat:test` runs only the compatibility fixture suite.
- [x] CI runs `pnpm compat:test`.
- [x] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` pass.
