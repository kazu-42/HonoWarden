# Week 26 Post Tag Release Packet

## Goal

Add a read-only post-tag release packet that proves a pushed alpha tag is safe
to use for GitHub release draft creation, without creating the draft or
publishing anything.

## Success Criteria

- `pnpm release:post-tag:packet` emits one JSON report covering local tag
  context, remote tag context, tag verification workflow CI, GitHub release
  planning, and existing release state.
- Strict mode fails when the tag workflow run evidence is missing, incomplete,
  failed, for the wrong workflow, or for the wrong commit.
- Remote annotated tags are peeled before comparing against the expected commit.
- The packet prints a release draft approval text only when required post-tag
  evidence is present, and performs no external writes.
- Focused tests, docs tests, full local checks, brand scan, and workflow
  verifier pass.

## Current Context

- `v0.1.0-alpha` tag creation and push are still operator-gated.
- The release tag verification workflow already exists and runs after the tag is
  pushed.
- GitHub release planning exists but does not verify the tag workflow run.
- The latest approved commit for repository-local readiness is discovered from
  the current `HEAD` unless explicitly pinned.

## Constraints

- Do not create, move, delete, or push `v0.1.0-alpha`.
- Do not create, update, publish, or delete a GitHub release.
- Do not deploy.
- Do not introduce blocked external brand strings.
- Tests must not depend on live tag or release creation.

## Risks

- Annotated Git tags expose a tag object SHA and a peeled commit SHA; comparing
  only the tag object can approve the wrong commit.
- A successful CI run from `main` is not sufficient; the post-tag packet must
  verify the `Release Tag Verification` run for the tag commit.
- An existing published release would make "draft creation" unsafe to repeat.

## Approval Required

No approval is required for local scripts, docs, tests, workflow artifacts, or
read-only GitHub/Git checks. Explicit operator approval is required before tag
creation, tag push, release draft creation, release publication, deployment,
DNS, or email routing changes.

## Work Packets

- Packet 01: CLI contract and implementation.
- Packet 02: Tests and fake Git/GitHub fixtures.
- Packet 03: Docs and workflow artifacts.
- Packet 04: Verification and CI.

## Integration Policy

The post-tag packet composes existing release planning rather than weakening it.
If any child check reports `not_ready`, the packet must remain `not_ready`.

## Verification

- `pnpm test -- test/ops/post-tag-release-packet.test.ts`
- `pnpm test -- test/release-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier
- GitHub Actions CI after push

## Reusable Artifacts

Use this packet after future pre-release tag pushes to gate release draft
creation on tag SHA, remote tag, workflow, and release-state evidence.
