# Packet 01: Tests

## Objective

Cover remote tag absence checking without relying on network access.

## Contract

- Create a temporary bare repository in the test.
- Run `--check-remote --remote <temp-remote>`.
- Assert the report includes `remote_tag_absent` with `pass`.
- Assert limitations differ when remote tag absence was verified.
