# Week 26 Release Command Repository Scope

## Goal

Make every emitted GitHub Release command explicitly target
`kazu-42/HonoWarden` so operator commands do not depend on the current working
directory.

## Success Criteria

- Release plan create/view commands include `--repo kazu-42/HonoWarden`.
- Publish packet publish/view commands include `--repo kazu-42/HonoWarden`.
- Published packet view command includes `--repo kazu-42/HonoWarden`.
- Status packet surfaces repo-scoped commands.
- Tests cover the repo-scoped command strings.
- No release publication or deployment occurs.

## Current Context

- The GitHub Release remains a draft prerelease.
- The release status packet reports `draft_ready_for_publication`.
- The next external action remains operator-approved publication.

## Constraints

- Do not publish the GitHub Release.
- Do not create, update, delete, or move tags.
- Do not deploy, change DNS, or change email routing.
- Keep the external compatibility brand name out of code and docs.

## Risks

- Operator commands without explicit repo scope could target the wrong
  repository if copied outside the intended working tree.
- Changing command strings can break downstream packet tests if not updated
  together.

## Approval Required

No approval is required for local script, tests, docs, and workflow artifact
updates. Release publication and deployment remain approval-gated.

## Work Packets

1. Command scope implementation.
2. Test and docs updates.
3. Verification and handoff.

## Integration Policy

Keep this slice scoped to emitted command strings. Do not mutate tags, GitHub
Release state, deployment state, DNS, email routing, or runtime API behavior.

## Verification

- `pnpm exec vitest run test/ops/github-release-plan.test.ts test/ops/post-tag-release-packet.test.ts test/ops/release-approval-packet.test.ts test/ops/release-evidence-bundle.test.ts test/ops/release-publish-packet.test.ts test/ops/release-published-packet.test.ts test/ops/release-status-packet.test.ts`
- `pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- repository brand scan
- workflow verifier

## Reusable Artifacts

Use explicit `--repo kazu-42/HonoWarden` on all future GitHub release commands
emitted for operator use.
