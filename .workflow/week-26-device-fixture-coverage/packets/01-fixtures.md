# Packet 01: Fixtures

## Objective

Add deterministic device fixture JSON for implemented read and preflight routes.

## Context

Device list, identifier lookup, and known-device preflight already have route
implementations and HTTP tests. Fixture coverage currently only includes device
revoke.

## Files / Sources

- `compat/fixtures/devices/list-success.json`
- `compat/fixtures/devices/identifier-success.json`
- `compat/fixtures/devices/known-device-success.json`

## Ownership

Spark owns fixture JSON only.

## Do

- Use synthetic device data only.
- Use `Bearer synthetic-access-token` for authenticated device read fixtures.
- Use base64url email `cGVyc29uQGV4YW1wbGUudGVzdA` for known-device preflight.
- Use root assertion path `$` for the scalar boolean response.

## Do Not

- Edit manifests, tests, docs, or source code.
- Add device mutation fixtures.
- Add external compatibility brand strings.

## Expected Output

- Three new fixture JSON files.

## Verification

- Main agent will run fixture validation and route replay tests.
