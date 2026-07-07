# Week 26 Release Approval Packet

## Goal

Add a read-only release approval packet that combines the alpha release gate,
remote tag preflight, GitHub release planning context, CI evidence, and exact
operator approval text for `v0.1.0-alpha`.

## Success Criteria

- `pnpm release:approval:packet` reports one JSON object with deterministic
  readiness checks and the exact approval text for the target commit.
- CI evidence is verified read-only through `gh run view` and must be
  successful for the current commit SHA.
- The packet runs only read-only commands and never creates tags, pushes tags,
  creates releases, publishes releases, deploys, or mutates external systems.
- Strict mode fails when required CI evidence is absent.
- Remote-aware preflight commands point at the checked remote.
- The tagging runbook requires a ready approval packet before operator approval.
- Focused tests, full local checks, release gate, brand scan, and workflow
  verifier pass.

## Current Context

- The repository-local release gate is ready on `main`.
- Tag creation and push remain blocked until explicit operator approval.
- GitHub release draft creation must wait until the tag exists and tag
  verification CI passes.
- The previous passing CI run for the current base commit is
  `28845145150`.

## Constraints

- Do not create or push `v0.1.0-alpha`.
- Do not create, update, publish, or delete a GitHub release.
- Do not deploy from a tag or release.
- Do not introduce blocked external brand strings into code or docs.
- Keep the packet reusable and machine-readable.

## Risks

- A stale CI run ID could approve a commit different from `HEAD`; the packet
  must verify the run's `headSha`.
- A remote preflight check that prints an `origin` push command after checking a
  different remote would create an operator footgun.
- Making the packet mutate repository or GitHub state would bypass the approval
  gate.

## Approval Required

No approval required for local code, docs, workflow artifacts, tests, or CI.
Explicit operator approval is required before tag creation, tag push, GitHub
release creation/publication, deployment, DNS changes, email routing changes, or
any other external write.

## Work Packets

- Packet 01: CLI contract and implementation.
- Packet 02: Tests and remote command invariants.
- Packet 03: Docs and workflow evidence.
- Packet 04: Verification and CI.

## Integration Policy

The packet may orchestrate existing release scripts but must not weaken their
checks. If a downstream script reports `not_ready`, the approval packet must
surface `not_ready` rather than hiding the failure.

## Verification

- `pnpm test -- test/ops/release-approval-packet.test.ts`
- `pnpm test -- test/ops/alpha-tag-preflight.test.ts`
- `pnpm release:approval:packet -- --allow-dirty --ci-run-id 28845145150 --ci-url https://github.com/kazu-42/HonoWarden/actions/runs/28845145150`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- `pnpm release:tag:preflight -- --strict --check-remote`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this packet as the final read-only approval bundle before future
operator-gated release tags. Update the target version/tag only in a dedicated
release-preparation slice.
