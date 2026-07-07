# Packet 01: Contract Tests

## Objective

Define the local alpha tag preflight report and strict failure behavior before
implementation.

## Contract

- The report has schema version `1`.
- The report targets `v0.1.0-alpha` and version `0.1.0-alpha`.
- The report includes a 40-character source commit.
- Checks include package version, release gate, working tree, and local tag
  absence.
- Strict mode exits non-zero and still prints JSON when a check fails.
