# Result 01: FakeD1 Multi-User Support

## Accepted

- Added `authUsers` lookup by normalized email and user id.
- Filtered folder and cipher `all()` responses by bound user id.
- Preserved existing `authUser`, `folder`, and `cipher` single-row overrides.

## Rejected

- Did not implement a general SQL interpreter in FakeD1.
- Did not change production repository predicates.
