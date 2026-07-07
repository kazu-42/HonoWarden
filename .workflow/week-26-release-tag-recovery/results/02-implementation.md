Result ID: 02-implementation
Status: accepted

Added `scripts/honowarden-release-tag-recovery-packet.mjs` and package script
`pnpm release:tag:recovery`.

The packet verifies:

- clean working tree
- recovery commit matches HEAD
- remote `main` points at the recovery commit
- local tag points at the expected current commit
- remote tag object and peeled commit match expectations
- main CI passed for the recovery commit
- the tag verification workflow failed for the current tag commit
- no GitHub release exists for the tag

It emits commands only; it does not run tag, push, release, deploy, DNS, or
email mutations.
