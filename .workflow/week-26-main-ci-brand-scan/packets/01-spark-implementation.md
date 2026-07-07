# Packet 01: Spark Implementation

Objective: add repository brand scan to the normal main CI workflow and a
focused workflow test.

Context:

- Release tag verification already has the scan.
- Main CI is the earlier PR/push gate and should enforce the same invariant.

Ownership:

- `.github/workflows/ci.yml`
- `test/ops/ci-workflow.test.ts`

Do:

- Add `Repository brand scan` before format check.
- Build the blocked pattern from split fragments.
- Assert the main CI workflow contains core checks and `BLOCKED_PATTERN`.

Do not:

- Run broad QA.
- Add contiguous forbidden provider-brand literals.
- Edit docs, source code, release scripts, or package metadata.

Expected output: a narrow implementation patch ready for main-agent QA.
