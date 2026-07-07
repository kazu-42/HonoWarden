# Result 01: CLI Contract

## Accepted

- Added `scripts/honowarden-release-evidence-bundle.mjs`.
- Added `release:evidence:bundle` to `package.json`.
- The bundle includes release gate, tag preflight, approval packet, post-tag
  preview, brand scan, commands, limitations, and approval text.

## Notes

- Local output writing is opt-in through `--output` and protected by
  `--overwrite`.
