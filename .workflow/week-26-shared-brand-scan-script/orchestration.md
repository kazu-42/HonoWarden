# Orchestration: Week 26 shared brand scan script

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Spark stores a contiguous blocked provider-brand token, rewrite to split
  runtime construction before running local checks.
- If the Node scanner produces false positives on generated or dependency
  files, compare against the existing workflow exclusions before changing
  policy.
- If release status remains `draft_ready_for_publication`, do not publish.

## Packet Prompts

### Packet 01: Spark Implementation

Objective: centralize repository brand scan in `pnpm brand:scan`.

Ownership:

- `scripts/honowarden-brand-scan.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-tag.yml`
- focused tests under `test/ops/`

Do:

- Implement a Node standard-library scanner with the existing exclusions.
- Update both workflows to call `pnpm brand:scan`.
- Add focused tests for scanner pass/fail behavior and workflow call sites.

Do not:

- Run broad QA.
- Edit docs or app source.
- Store the blocked provider-brand token contiguously.

### Packet 02: Main Integration And Evidence

Objective: review, document, verify, commit, push, and record CI evidence.

Ownership:

- `docs/current-state.md`
- `.workflow/week-26-shared-brand-scan-script/**`

Do:

- Review Spark changes.
- Update docs with shared scanner details.
- Run focused and broad local checks plus read-only release audits.
- Push and verify GitHub Actions.

Do not:

- Publish releases, move tags, deploy, or mutate external systems.

## Completion Audit

- Both workflows call `pnpm brand:scan`.
- Shared scanner focused tests pass.
- Full local checks and pushed CI pass.
