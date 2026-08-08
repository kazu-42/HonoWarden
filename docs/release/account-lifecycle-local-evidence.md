# Account Lifecycle Local Evidence

Status: source and local synthetic evidence passed; no deployment claim.

Recorded: 2026-08-09.

Issue: `HON-164`.

This packet records repository-local evidence for account email change,
email verification, recoverable deletion, recovery, and irreversible personal-
data purge. All tests use synthetic identities, local D1, and an in-memory R2
double. No provider message, remote database, production account, or real vault
data was accessed or mutated.

## Claim Boundary

The source implements the pinned official server/client route and DTO surface,
but this packet does not prove official-client UI behavior or compatibility.
The tracked feature flag is `false` in top-level, staging, and production
Wrangler configuration. Activation additionally requires a reviewed mailer
service binding and a lifecycle secret of at least 32 UTF-8 bytes.

No public HTTP operator endpoint exists. Recovery and purge are available only
through the named `AccountLifecycleOperator` Worker entrypoint, which requires
an explicit Cloudflare service binding. The repository CLI emits redacted plans
and refuses lifecycle mutation execution; it cannot bypass the state machine by
directly flipping account status.

## Locally Proven Invariants

- Disabled and misconfigured lifecycle routes fail before D1 access.
- Raw 256-bit tokens are not persisted; only purpose/user/generation-bound
  HMAC-SHA256 digests are stored.
- A newer token supersedes the prior active token, and failed delivery cannot
  leave an accepted token active.
- Unknown and known anonymous deletion-token requests return the same empty
  response while the mailer receives an explicit `suppress` or `deliver`
  disposition. This proves the source contract, not deployed mailer latency or
  suppression behavior.
- Email change replaces one credential generation atomically, updates the
  membership email projection, revokes sessions and pending auth requests, and
  records wrapper history plus audit evidence. A mixed-case target membership
  collision is rejected before any identity mutation.
- Recoverable deletion rejects the last confirmed active organization owner,
  disables the account atomically, revokes sessions, and preserves encrypted
  personal and organization data until the cutoff.
- Before-cutoff recovery creates a new security stamp and does not resurrect
  old sessions.
- Purge inventories and deletes at most 1,000 personal R2 objects per private
  RPC invocation, records cumulative progress, safely retries missing objects,
  rejects stale counter regressions from overlapping calls, and finalizes D1
  only after the expected count is complete. A synthetic 1,001-object case
  proves that two calls are required.
- Purge planning, readiness, R2 start, and final D1 tombstoning fail closed if
  recovery-window membership changes make the disabled account the last
  confirmed organization owner.
- Purge removes retained TOTP challenges and custom equivalent-domain settings,
  preserves organization-owned ciphers and attachment objects, detaches
  personal folder references where necessary, and retains a non-reusable user
  tombstone plus an operation-id audit lease.

## Commands And Results

Focused TDD and integration commands passed during implementation:

```sh
pnpm exec vitest run test/domain/account-lifecycle.test.ts \
  test/repositories/account-lifecycle-repository.test.ts \
  test/account-lifecycle-mailer.test.ts \
  test/account-lifecycle-migration.test.ts \
  test/account-lifecycle-routes.test.ts

pnpm exec vitest run test/integration/account-lifecycle-d1.test.ts
pnpm exec vitest run test/app.test.ts test/ops/account-lifecycle-cli.test.ts
pnpm check
pnpm lint
pnpm format
pnpm brand:scan
```

Final repository-wide readback after review remediation:

- `pnpm test`: 113 files, 2,196 tests passed;
- `pnpm compat:test`: 6 files, 919 tests passed;
- `pnpm release:gate -- --strict`: 11 pass, 0 manual, 0 block;
- `pnpm check`, `pnpm lint`, `pnpm format`, and `pnpm brand:scan`: passed;
- `git diff --check`: passed.

Independent review exercised the uncommitted source and identified three
acceptance-relevant gaps: mixed-case organization membership collisions,
last-owner drift during the recovery window, and CLI/private-RPC input-boundary
drift. Each was reproduced with a failing test, remediated, and included in the
final full-suite result. The review runner's own nested Miniflare process could
not complete in its restricted child environment; the same real-D1 tests and
the entire repository suite completed in the normal local environment above.

The complete 18-file migration chain was also applied to a new disposable local
Wrangler D1 target. Readback returned migration ledger version `0017`, tables
`account_deletions` and `account_lifecycle_tokens`, and the
`users.email_verified_at` column. A top-level `wrangler deploy --dry-run`
bundled the Worker successfully and the emitted module retained the named
`AccountLifecycleOperator` export. The final source dry run reported a 743.11
KiB upload (124.86 KiB gzip) with the lifecycle flag still `false`. Neither
command contacted or mutated a remote Cloudflare resource.

The final full-suite, compatibility, and release-gate results are recorded in
the HON-164 pull request checks. This file must not be changed to claim staging,
production, mail-provider, or official-client evidence without a separately
approved live run and redacted readback.

## Rollout And Rollback Boundary

Apply migration `0017` before deploying the complete lifecycle reader and
private operator surface. Keep `HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED=false`
through that deployment and verify schema/read behavior first. Writer
activation is a later reviewed operation.

Rollback keeps migration `0017` and deploys a complete reader/operator version
with public writers disabled. A committed email generation rolls forward. A
recoverable deletion may be recovered only before its cutoff through the named
operator. A purge that has crossed the cutoff or begun R2 deletion must be
resumed idempotently; it cannot be reversed by direct D1 edits or partial backup
restore. See [Rollback Guide](rollback-guide.md).
