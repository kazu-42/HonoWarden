# Result 01: Repositories And Routes

Status: completed locally before broad verification.

Accepted:

- Added owner-scoped `findFolderById`.
- Added owner-scoped `findCipherById`.
- Added authenticated direct folder and cipher list/get routes.
- Reused existing folder and cipher response builders.
- Updated FakeD1 deleted-row filtering to reflect repository SQL.

Rejected:

- No pagination, attachment, collection, or shared-vault behavior was added.
- No external state was changed.

Verification:

- Touched tests passed in the combined local test run.
- Typecheck passed.
