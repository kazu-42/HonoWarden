# Packet 02: HTTP Isolation Tests

## Objective

Add app-level regression tests for disabled auth flows and multi-user sync
isolation.

## Scope

- `test/app.test.ts`

## Result

Added disabled password-grant and disabled refresh-grant tests with generic
invalid-grant expectations. Added a mixed Alice/Bob sync test that expects each
token to receive only its own folders and ciphers.
