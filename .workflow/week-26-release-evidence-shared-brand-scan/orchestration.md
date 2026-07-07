# Orchestration: Week 26 release evidence shared brand scan

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If output shape changes, adjust only focused tests when compatibility is
  intentionally preserved.
- If scanner subprocess execution fails for reasons other than blocked content,
  surface a `fail` brandScan result with a diagnostic detail.
- If release status remains `draft_ready_for_publication`, do not publish.

## Packet Prompts

### Packet 01: Spark Implementation

Objective: make release evidence bundle use the shared brand scan script.

Ownership:

- `scripts/honowarden-release-evidence-bundle.mjs`
- `test/ops/release-evidence-bundle.test.ts`

Do:

- Remove duplicate recursive scan/pattern code from evidence bundle.
- Invoke `scripts/honowarden-brand-scan.mjs` via `process.execPath`.
- Preserve `brandScan` evidence shape.
- Run focused release evidence tests if useful.

Do not:

- Edit docs, workflow artifacts, package metadata, workflows, or app source.
- Store the blocked provider-brand token contiguously.
- Run broad QA.

### Packet 02: Main Integration And Evidence

Objective: review, document, verify, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `.workflow/week-26-release-evidence-shared-brand-scan/**`

Do:

- Review Spark changes.
- Update docs to note evidence bundle uses shared scanner.
- Run local checks and read-only release audits.
- Push and verify GitHub Actions.

Do not:

- Publish releases, move tags, deploy, or mutate external systems.

## Completion Audit

- Evidence bundle delegates to shared brand scanner.
- Focused and broad checks pass.
- Pushed CI passes.
