# Week 26 Post Alpha Ops Readiness Packet

## Goal

Add a read-only operations readiness packet that separates alpha GitHub Release
completion from post-release operational readiness for website, Cloudflare
Worker deploy, email routing, and live smoke evidence.

## Success Criteria

- `pnpm ops:readiness:packet` prints a JSON report.
- The packet never publishes a release, deploys, changes DNS, configures email,
  or sends mail.
- The packet aggregates the existing release completion audit and email
  preflight without printing secrets.
- The packet reports draft-ready alpha state as `not_ready` for operations and
  names the blocking gate.
- Tests cover draft-ready, email-input-ready, and published-but-ops-evidence
  incomplete states.
- Release docs explain that this packet is post-alpha operational evidence, not
  release-publication approval.

## Current Context

The GitHub Release draft for `v0.1.0-alpha` is ready for publication approval,
but publication itself remains an explicit external write gate. The repository
also has local evidence for Cloudflare D1/R2 resources, staging dry-run, website
and email planning, and email local input preflight, but live Worker deploy,
Email Routing, DNS, and post-deploy smoke evidence must remain separate from
release completion.

## Constraints

- Do not mutate Git tags, GitHub Releases, Cloudflare, DNS, email routing,
  Linear, or secrets.
- Keep provider-brand blocked strings out of tracked files.
- Keep alpha release completion and post-alpha operational readiness as separate
  gates.
- Use local tests and fake `git`/`gh` binaries for external readback modeling.

## Risks

- Treating documentation-only website status as live evidence would overstate
  readiness.
- Folding ops readiness into `release:completion:audit` would make the alpha
  completion contract ambiguous.
- Printing email destinations or Cloudflare tokens would leak operator secrets.

## Approval Required

No approval is required for local script, test, docs, and workflow artifact
changes. Approval is required before publishing the GitHub Release, deploying a
Worker, changing DNS, configuring Email Routing, sending test mail, or writing
production secrets.

## Work Packets

- `01-contract`: define the packet schema, blocking rules, and package command.
- `02-tests`: cover draft-ready and published-release states with fake external
  commands.
- `03-docs-workflow`: document the packet and record workflow evidence.
- `04-verification`: run focused tests, local gates, workflow verification, and
  release status readback.

## Integration Policy

Accept only changes that keep the packet read-only and conservative. Reject any
change that marks operations ready from documentation-only status or local input
presence alone.

## Verification

- `pnpm exec vitest run test/ops/ops-readiness-packet.test.ts`
- `pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-post-alpha-ops-readiness-packet`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm brand:scan`

## Reusable Artifacts

The resulting packet can be reused as the read-only checkpoint before requesting
Cloudflare deploy, DNS, and Email Routing approvals.
