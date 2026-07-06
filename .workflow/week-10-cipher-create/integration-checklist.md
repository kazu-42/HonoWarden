# Integration Checklist: week-10-cipher-create

## Accepted

- Cipher persistence is owner-scoped.
- Optional folder references are checked against active folders owned by the authenticated user.
- Sync includes active ciphers.
- Cipher create has HTTP tests for success, invalid body, and missing folder.

## Rejected

- No cipher update/delete/restore was added.
- No hard-delete behavior was added.
- No real secrets were set.
- No Cloudflare deploy was performed.

## Conflicts

- None.

## Decisions

- This slice only accepts login ciphers with `type: 1`.
- Stored server metadata overrides any conflicting request metadata in responses.
- Cipher payload is validated structurally but encrypted fields are otherwise opaque.

## Verification Still Needed

- GitHub Actions CI after push.
