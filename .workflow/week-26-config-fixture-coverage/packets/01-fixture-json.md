# Packet 01: Fixture JSON

## Objective

Draft `compat/fixtures/config/server-config-success.json` for the anonymous
server config endpoint.

## Context

The app exposes `GET /api/config` and derives environment URLs from the request
origin. Route replay uses the fixture endpoint path directly, so the expected
origin for a relative `/api/config` fixture is likely `http://localhost`.

## Ownership

Only `compat/fixtures/config/server-config-success.json`.

## Do

- Follow the existing compatibility fixture schema.
- Use `GET /api/config`.
- Include response body fields that match `buildServerConfig`.
- Include deterministic assertions for `object`, `version`, environment URLs,
  disabled registration, and push technology.

## Do Not

- Do not update manifests, tests, docs, workflow files, or package files.
- Do not run QA.
- Do not introduce external compatibility brand names.

## Expected Output

The fixture file plus a short summary of response shape and assertions.
