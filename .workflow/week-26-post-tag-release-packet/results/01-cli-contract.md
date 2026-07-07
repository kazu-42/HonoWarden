# Result 01: CLI Contract

## Accepted

- Added `scripts/honowarden-post-tag-release-packet.mjs`.
- Added `release:post-tag:packet` to `package.json`.
- The packet reports tag context, tag workflow evidence, release planning,
  release state, commands, limitations, and release draft approval text.
- The draft approval text is omitted when required post-tag evidence is allowed
  missing for dry-run checks.

## Notes

- The script uses existing GitHub release planning for `createDraft` rather than
  duplicating that command contract.
