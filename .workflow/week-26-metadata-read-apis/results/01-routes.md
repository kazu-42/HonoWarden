# Result 01: Routes

Status: completed locally before broad verification.

Accepted:

- Added authenticated policy list routes.
- Added authenticated domain metadata routes.
- Reused the domain response shape for sync and direct domain endpoints.

Rejected:

- No policy enforcement or management behavior was added.
- No custom equivalent-domain configuration was added.
- No external state was changed.

Verification:

- Touched tests passed in the combined local test run.
- Typecheck passed.
