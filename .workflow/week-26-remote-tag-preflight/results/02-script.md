# Result 02: Script

## Accepted

- Added `--check-remote`.
- Added `--remote <remote>` with default `origin`.
- Added `remote_tag_absent` check using `git ls-remote --tags`.
- Kept default behavior local-only when `--check-remote` is omitted.

## Rejected

- No local tag was created.
- No tag was pushed.
- No remote tag was deleted or rewritten.
