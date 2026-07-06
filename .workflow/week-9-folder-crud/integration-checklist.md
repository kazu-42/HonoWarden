# Integration Checklist: week-9-folder-crud

## Accepted

- Folder persistence is owner-scoped.
- Protected-route auth is shared across sync and folder routes.
- Sync includes active folders.
- Folder create, update, and delete have HTTP tests.

## Rejected

- No cipher CRUD was added.
- No hard-delete behavior was added.
- No real secrets were set.
- No Cloudflare deploy was performed.

## Conflicts

- None.

## Decisions

- Folder delete uses soft delete.
- Missing, deleted, or cross-user folder writes return the same `404 folder_not_found`.
- Folder names are validated only as non-empty strings and otherwise treated as opaque encrypted payloads.

## Verification Still Needed

- None for implementation commit `e11b41c`; CI passed in run `28786414228`.
