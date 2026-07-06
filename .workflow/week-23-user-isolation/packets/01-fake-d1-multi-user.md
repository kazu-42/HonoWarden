# Packet 01: FakeD1 Multi-User Support

## Objective

Make test support capable of proving user-bound sync isolation with mixed
synthetic rows.

## Scope

- `test/support/fake-d1.ts`

## Result

FakeD1 now supports multiple auth users and filters folder/cipher `all()` rows
by the bound user id. Existing single-row overrides remain supported for focused
not-found and conflict tests.
