Result ID: 03-docs-workflow
Status: accepted

Updated `docs/release/tagging-runbook.md` to require the recovery packet before
replacing a pushed tag.

Updated `docs/current-state.md` with a Week 26 release tag recovery packet
section.

Updated `test/release-docs.test.ts` so release docs must mention
`pnpm release:tag:recovery -- --strict` and `--force-with-lease`.
