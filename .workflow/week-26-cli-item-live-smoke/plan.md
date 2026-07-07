# Week 26 CLI Item Live Smoke

## Goal

Extend the tracked CLI live smoke beyond empty sync by creating, updating,
trashing or deleting, and re-syncing one synthetic login item against the local
HonoWarden Worker.

## Success Criteria

- Real tracked CLI binary can authenticate against local HonoWarden.
- A synthetic login item can be created through the CLI.
- A subsequent sync returns the created item.
- Update and deletion behavior is either verified or the exact missing
  protocol gap is recorded with tests.
- No real secrets, real vault data, tokens, session keys, password hashes, or
  generated key material are committed.
- Compatibility docs and workflow artifacts reflect the true result.
- Local checks, brand scans, and GitHub Actions CI pass.

## Current Context

- Previous workflow `week-26-live-client-evidence` proved config, prelogin,
  password grant, empty sync, and revision lookup for CLI `2026.6.0`.
- `compat/client-matrix.json` has the CLI row at `live_smoke`; non-CLI rows
  remain `fixture_only`.
- Local wrangler dev needs a compression-stripping HTTPS proxy for this CLI
  stack when using a self-signed local endpoint.

## Constraints

- Do not add upstream provider brand text to tracked source, docs, or paths.
- Spark/subagents are not used for QA.
- Keep the run synthetic and local unless a separate Cloudflare deploy gate is
  explicitly chosen.
- Preserve the server-side encryption boundary; the server stores opaque
  payloads and must not need plaintext vault fields.

## Risks

- CLI item commands may call API routes that are not implemented yet.
- CLI-created encrypted payload shape may differ from fixture-only examples.
- Local dev proxy can hide transport-only issues; record this limitation
  honestly.

## Approval Required

No additional approval is required for local wrangler dev, ignored temporary
files, local D1 cleanup of synthetic rows, code edits, commits, pushes, and CI.
Cloudflare deploys, remote secret writes, route changes, and production data
remain out of scope for this workflow.

## Work Packets

1. Local smoke setup: migrate local D1, create synthetic account, start local
   Worker and proxy.
2. CLI mutation discovery: run item create/update/delete/sync and capture
   non-secret result metadata.
3. Compatibility implementation: patch HonoWarden only for confirmed client
   protocol gaps.
4. Evidence integration: update fixtures/docs/matrix/workflow without secrets.
5. Verification: run local gates, brand scans, commit, push, and confirm CI.

## Integration Policy

Accept only changes backed by a failing real CLI request, an existing fixture
contract, or a repository test. Keep non-CLI surfaces conservative.

## Verification

- Targeted CLI live smoke.
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- `pnpm release:gate -- --strict`
- Repository content and path brand scans.
- GitHub Actions CI on pushed commits.

## Reusable Artifacts

If the CLI mutation smoke succeeds, add the exact redacted flow and limits to
`docs/release/live-client-evidence.md` and the workflow final report.
