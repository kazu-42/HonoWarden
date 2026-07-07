# Result 01: Fixture JSON

Accepted Spark output:

- Added `compat/fixtures/accounts/revision-date-success.json`.
- Fixture targets `GET /api/accounts/revision-date`.
- Request uses `Authorization: Bearer synthetic-access-token` so replay can
  replace it with a signed deterministic token.
- Response body is the scalar JSON string
  `2026-07-06T00:00:00.000Z`.
- Assertion checks `$` has type `string` and the exact timestamp value.
