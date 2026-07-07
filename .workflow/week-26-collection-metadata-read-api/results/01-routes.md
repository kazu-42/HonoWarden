# Result 01: Routes

Status: completed locally before broad verification.

Accepted:

- Added authenticated collection list route.
- Added authenticated collection lookup route returning stable not-found.
- Kept collection mutation routes on the existing unsupported response.

Rejected:

- No collection persistence, mutation, assignment, or organization scope was
  added.
- No external state was changed.

Verification:

- Touched tests passed in the combined local test run.
- Typecheck passed.
