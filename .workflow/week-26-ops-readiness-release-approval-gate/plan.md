# Week 26 ops readiness release approval gate

## Goal

- Add explicit release publication approval-gate details to the ops readiness packet slice so the packet clearly separates publication approval from deploy/DNS/Email Routing readiness.

## Success Criteria

- The workflow artifacts explicitly include a named requirement that release publication approval is still required before declaring completion.
- The packet language records the blocking reason format and documents why this is a safe local gate artifact.
- Packet set includes contract/code, tests/docs, and verification outputs.
- All implementation and verification text explicitly avoids external write actions.

## Current Context

- This workflow is used only for planning/recording packet semantics around post-release readiness; it does not execute release, deploy, or DNS/email mutations itself.

## Constraints

- Do not mutate tags.
- Do not publish GitHub releases.
- Do not perform Cloudflare deploy, DNS, or Email Routing writes.
- Do not send email or write secrets from this workflow slice.

## Risks

- Overstating packet readiness by implying publication equals deploy readiness.
- Weakening the release gate model if tests/docs packets are written without clear blockers.

## Approval Required

- No approval is required for local workflow-artifact edits and scoped planning.
- Explicit operator approval is still required before any tag/release mutation, deploy, DNS update, Email Routing, email send, or secret write.

## Work Packets

- Packet 01: contract/code — add release publication approval gate semantics to the packet contract text.
- Packet 02: tests/docs — update workflow documentation to anchor read-only proof language and command expectations.
- Packet 03: verification — document evidence collection strategy and leave completion status pending until run by the main agent.

## Integration Policy

- Keep packet semantics additive and non-operational.
- Treat missing or unverified release publication approval as a blocking condition.
- Require explicit external actions as separate gates; this workflow records status only.

## Verification

- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-ops-readiness-release-approval-gate`
- `pnpm ops:readiness:packet -- --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- `pnpm release:status:packet -- --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- `pnpm release:completion:audit -- --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`

## Reusable Artifacts

- Use this workflow as the local artifact baseline when adding the release publication
  requirement into future ops-readiness or completion-gate packet updates.
