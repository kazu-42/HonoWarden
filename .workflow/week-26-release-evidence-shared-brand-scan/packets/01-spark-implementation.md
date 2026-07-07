# Packet 01: Spark Implementation

Objective: make the release evidence bundle reuse the shared brand scanner.

Ownership:

- `scripts/honowarden-release-evidence-bundle.mjs`
- `test/ops/release-evidence-bundle.test.ts`

Do:

- Delegate brand scanning to `scripts/honowarden-brand-scan.mjs`.
- Preserve `brandScan` evidence shape.
- Remove duplicate recursive scan/pattern logic.
- Keep tests focused.

Do not:

- Store the blocked provider-brand token contiguously.
- Edit docs, workflow artifacts, app source, package metadata, or workflows.
- Run broad QA.

Expected output: a small release tooling patch ready for main-agent QA.
