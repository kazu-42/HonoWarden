Result ID: 01-cli-contract
Status: accepted

Added `test/ops/release-tag-recovery-packet.test.ts`.

The tests cover:

- ready output with exact approval text and force-with-lease command
- blocking when a GitHub release already exists
- strict failure when main CI evidence is missing

The tests use fake `git` and `gh` commands and do not mutate real tags or
GitHub release state.
*** Add File: .workflow/week-26-release-tag-recovery/results/02-implementation.md
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
*** Add File: .workflow/week-26-release-tag-recovery/results/03-docs-workflow.md
Result ID: 03-docs-workflow
Status: accepted

Updated `docs/release/tagging-runbook.md` to require the recovery packet before
replacing a pushed tag.

Updated `docs/current-state.md` with a Week 26 release tag recovery packet
section.

Updated `test/release-docs.test.ts` so release docs must mention
`pnpm release:tag:recovery -- --strict` and `--force-with-lease`.
*** Add File: .workflow/week-26-release-tag-recovery/results/04-verification.md
Result ID: 04-verification
Status: in_progress

Local verification completed before this result file was written:

- `pnpm exec vitest run test/ops/release-tag-recovery-packet.test.ts test/release-docs.test.ts test/ops/release-evidence-bundle.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan

Still required:

- workflow artifact verifier after packet/result files are present
- commit and push to main
- GitHub Actions CI evidence for this recovery-packet commit
- final recovery packet run on the clean, CI-backed commit
- explicit operator approval before tag movement
