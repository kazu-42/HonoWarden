# Two-User Dogfood And Disabled-User Evidence

Target: `v0.1.0-alpha`.

Status: synthetic local evidence captured; production account lifecycle
execution remains operator-gated.

This document records the minimum evidence contract for HON-61. The goal is to
prove that HonoWarden can exercise two synthetic users and disabled-user denial
paths without touching real vault data or production accounts.

## Evidence Level

Current level: `synthetic_dogfood`.

The committed evidence is local and synthetic. It does not claim a browser,
desktop, mobile, or production dogfood run. It does prove the server acceptance
criteria through the same app routes used by clients:

- two synthetic users are bootstrapped through `POST /api/accounts/bootstrap`;
- both users complete password grant and `GET /api/sync`;
- sync results remain owner-scoped for folders and ciphers;
- cross-user direct reads return `404`;
- cross-user cipher mutation returns `404`;
- a disabled user is denied by password grant, refresh grant, sync, folder
  create, and cipher create;
- the account lifecycle rollback path remains represented by the dry-run-first
  `pnpm account:lifecycle` command.

## Packet

Generate a redacted packet before promoting or re-running the dogfood evidence:

```sh
pnpm dogfood:evidence:packet -- \
  --strict \
  --environment local \
  --server-url https://localhost:8791 \
  --source-commit <server-commit> \
  --run-id <run-id> \
  --synthetic-user dogfood-user-a \
  --synthetic-user dogfood-user-b \
  --flow bootstrap_user_a \
  --flow bootstrap_user_b \
  --flow user_a_initial_sync \
  --flow user_b_initial_sync \
  --flow cross_user_sync_isolation \
  --flow cross_user_read_denied \
  --flow cross_user_mutation_denied \
  --flow disable_user \
  --flow disabled_password_grant_denied \
  --flow disabled_refresh_grant_denied \
  --flow disabled_sync_denied \
  --flow disabled_vault_crud_denied \
  --flow enable_user_rollback_plan
```

The packet is intentionally conservative. It validates evidence shape, source
commit, environment URL redaction, evidence directory placement, synthetic-user
tags, and required flow coverage. It does not create users, run a real client,
deploy Workers, apply D1 migrations, or change Cloudflare routing.

## App Evidence

The focused app-level dogfood test is:

```sh
pnpm vitest run test/ops/dogfood-synthetic-lifecycle.test.ts
```

That test uses a stateful `FakeD1Database` with synthetic account rows only. It
boots two users in the same fake database, seeds synthetic folder and cipher
rows for each user, runs password grants and sync for both, checks cross-user
read and mutation denials, marks one user disabled, and verifies the disabled
denials required by the issue.

The test stores no request bodies, response bodies, access tokens, refresh
tokens, raw passwords, private keys, real email addresses, forwarding
destinations, or vault exports. Route names, HTTP statuses, synthetic IDs, and
pass/fail assertions are the intended evidence.

## Operator Lifecycle Boundary

The account lifecycle CLI remains the production path for disable and enable
operations:

```sh
pnpm account:lifecycle -- \
  disable \
  --email owner@example.test \
  --database honowarden \
  --mode remote \
  --env production \
  --reason owner-request-YYYYMMDD
```

The CLI is dry-run by default and prints readback, guarded mutation, post-read,
and rollback commands. Production execution requires `--execute --confirm`.
That production operator run is not claimed by this document.

## Required Flow Groups

Every future dogfood evidence packet must cover:

- bootstrap: `bootstrap_user_a`, `bootstrap_user_b`;
- isolation: `user_a_initial_sync`, `user_b_initial_sync`,
  `cross_user_sync_isolation`, `cross_user_read_denied`,
  `cross_user_mutation_denied`;
- disabled lifecycle: `disable_user`, `disabled_password_grant_denied`,
  `disabled_refresh_grant_denied`, `disabled_sync_denied`,
  `disabled_vault_crud_denied`;
- rollback: `enable_user_rollback_plan`.

The rollback requirement exists because disable operations are operationally
sensitive. Even when a test only toggles a local synthetic user, the evidence
must keep the enable path visible to avoid one-way operational playbooks.

## Evidence Rules

Evidence must remain synthetic-only:

- no real vault data;
- no real passwords;
- no access tokens, refresh tokens, session keys, private keys, seed phrases,
  recovery codes, or decrypted values;
- no raw request or response bodies;
- no real mailbox content, forwarding destinations, or unrelated operator
  account data;
- no production account disable or enable unless a separate operator approval
  and rollback record exists.

Allowed evidence includes route names, status codes, synthetic IDs, synthetic
user tags, source commit, run ID, command names, and pass/fail summaries.

## Current Run Record

The current committed evidence is repository-local:

- script: `scripts/honowarden-dogfood-evidence-packet.mjs`;
- package command: `pnpm dogfood:evidence:packet`;
- app evidence test: `test/ops/dogfood-synthetic-lifecycle.test.ts`;
- packet tests: `test/ops/dogfood-evidence-packet.test.ts`;
- workflow artifact:
  `.workflow/week-26-two-user-dogfood-evidence/state.json`.

Validation for the merged change must include the focused dogfood tests, type
check, lint, full tests, release gate, and secret/brand scan. If any future run
uses staging or production, record the environment, source commit, run ID,
redacted HTTP status summary, pre/post lifecycle readback counts, and rollback
command without raw account data.
