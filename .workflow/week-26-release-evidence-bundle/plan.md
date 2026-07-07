# Week 26 Release Evidence Bundle

## Goal

Add a read-only pre-tag evidence bundle that gathers the final alpha tag
approval evidence into one JSON artifact.

## Success Criteria

- `pnpm release:evidence:bundle` emits a pre-tag JSON report with release gate,
  remote tag preflight, approval packet, post-tag preview, and repository brand
  scan evidence.
- The bundle can optionally write the JSON to a local `--output` path without
  overwriting existing files unless `--overwrite` is provided.
- The bundle emits tag approval text only when strict evidence is ready for the
  exact commit and CI evidence is not missing-allowed.
- Focused tests cover ready output, explicit local output writing, and strict
  failure without CI evidence.
- Full local checks, brand scan, workflow verifier, and CI pass.

## Current Context

- `pnpm release:approval:packet` can prove tag approval readiness for a CI run.
- `pnpm release:post-tag:packet` can preview the post-tag release draft gate.
- The release runbook still required operators to collect several outputs
  manually before requesting tag approval.
- `v0.1.0-alpha` has not been created locally or remotely.

## Constraints

- Do not create, move, delete, or push `v0.1.0-alpha`.
- Do not create, update, publish, or delete a GitHub release.
- Do not deploy.
- Do not introduce blocked external brand strings.
- Treat `--output` as local evidence artifact generation only.

## Risks

- Evidence scattered across multiple commands can lead to approval for the wrong
  commit or stale CI run.
- A dirty working tree can make evidence non-reproducible; final strict evidence
  must be generated from a clean tree.
- A bundle that emits approval text while CI evidence is missing would weaken
  the release gate.

## Approval Required

No approval is required for local scripts, docs, workflow artifacts, tests, or
read-only checks. Explicit operator approval is required before tag creation,
tag push, release draft creation, release publication, deployment, DNS, or email
routing changes.

## Work Packets

- Packet 01: CLI contract and implementation.
- Packet 02: Tests and fake GitHub fixtures.
- Packet 03: Docs and workflow evidence.
- Packet 04: Verification and CI.

## Integration Policy

Compose existing release scripts rather than duplicating readiness logic. If a
child packet reports `not_ready`, the bundle must surface `not_ready`.

## Verification

- `pnpm test -- test/ops/release-evidence-bundle.test.ts`
- `pnpm test -- test/release-docs.test.ts`
- `pnpm release:evidence:bundle -- --allow-dirty --ci-run-id 28846213680 --ci-url https://github.com/kazu-42/HonoWarden/actions/runs/28846213680`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this bundle as the final pre-tag evidence artifact for future pre-release
tags. Save generated JSON under `docs/release/evidence/` only when an operator
intends to preserve the approval record.
