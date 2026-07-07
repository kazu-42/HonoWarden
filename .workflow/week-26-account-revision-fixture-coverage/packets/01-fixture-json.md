# Packet 01: Fixture JSON

## Objective

Draft `compat/fixtures/accounts/revision-date-success.json` for the
authenticated account revision-date read endpoint.

## Context

The app already exposes `GET /api/accounts/revision-date`. Existing route replay
fixtures replace `Authorization: Bearer synthetic-access-token` with a signed
fixture token and seed a deterministic auth user whose default `revisionDate` is
`2026-07-06T00:00:00.000Z`.

## Ownership

Only `compat/fixtures/accounts/revision-date-success.json`.

## Do

- Follow the existing fixture schema used under `compat/fixtures/accounts/`.
- Use `GET /api/accounts/revision-date`.
- Include deterministic assertions that prove the response body is the revision
  timestamp, not just a successful HTTP status.

## Do Not

- Do not update manifests, docs, tests, or workflow files.
- Do not run QA.
- Do not introduce external compatibility brand names.

## Expected Output

The fixture file plus a brief summary of the response shape and assertions.
