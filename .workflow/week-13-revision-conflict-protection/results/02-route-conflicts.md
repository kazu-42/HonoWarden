# Packet 02 Result: Route Conflicts

Accepted:

- Folder update requests now require `revisionDate`.
- Cipher update requests now require `revisionDate`.
- Stale folder and cipher updates return `409 revision_conflict`.
- Missing, deleted, and cross-user update targets continue to return `404`.
- Create request behavior remains revision-free.

Verification:

- Targeted app tests passed.
- Fake D1 supports owner-scoped active cipher revision reads for conflict tests.

Remaining risks:

- Live client capture fixtures should confirm exact payload shape expectations before a beta release.
