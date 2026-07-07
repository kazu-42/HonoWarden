# Result 01: Fixture JSON

Accepted Spark output with local assertion adjustment:

- Added `compat/fixtures/config/server-config-success.json`.
- Fixture targets anonymous `GET /api/config`.
- Response body follows the current server config contract for the replay origin
  `http://localhost`.
- Assertions check `object`, `version`, `gitHash`, environment URLs, disabled
  registration, push metadata, null communication fields, and the exact
  `featureStates` object.

Adjustment:

- Replaced individual hyphenated `featureStates` JSON paths with a single
  `$.featureStates` exact object assertion because the fixture path validator
  intentionally supports only alphanumeric and underscore property names.
