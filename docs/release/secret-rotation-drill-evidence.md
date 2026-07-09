# Secret Rotation Drill Evidence

Exercise date: 2026-07-09.

Status: passed dry-run.

Mode: repository-local formal dry-run. No live mutation, real secret rotation,
Wrangler secret write, Cloudflare token revoke, GitHub token change, Linear key
change, Email Routing destination change, D1/R2 data mutation, or production
deploy was performed.

## Command

The dry-run packet was generated with:

```sh
direnv exec /Users/hackhike/dev/HonoWarden pnpm secret:rotation:drill -- dry-run --strict --out test/.tmp/secret-rotation-drill.json
```

The output path is ignored local evidence because it contains environment
variable names and configured/missing booleans. It does not contain secret
values, private forwarding destinations, bearer tokens, plaintext TOTP secrets,
encrypted vault payloads, or mailbox content.

## Packet Summary

The packet reported:

| Field                          | Value                            |
| ------------------------------ | -------------------------------- |
| `action`                       | `formal_secret_rotation_dry_run` |
| `status`                       | `ready`                          |
| `mode`                         | `dry_run`                        |
| `liveMutationPerformed`        | `false`                          |
| `realSecretRotationPerformed`  | `false`                          |
| Covered credential classes     | `9`                              |
| Per-class status               | `covered`                        |
| External API calls by the CLI  | none                             |
| Secret values printed or saved | none                             |

Covered credential classes:

- bootstrap token
- refresh-token / legacy access-token secret
- access-token staged keyring
- TOTP wrapping secret and operator rewrap inputs
- scoped Cloudflare account tokens
- Cloudflare global-key break-glass fallback
- GitHub token or keychain-backed GitHub automation
- Linear API key
- private Email Routing forwarding destinations

## Boundary

This evidence closes the formal dry-run gap only. It intentionally does not
prove that a live secret has been rotated, revoked, retired, or replaced.

Live rotation still requires a separate operator-owned change window with:

- explicit issue ID, owner, target environment, credential class, and UTC
  timestamp before mutation
- read-only or dry-run evidence before mutation unless compromise requires
  immediate containment
- old credential kept active until replacement readback passes, except for
  confirmed compromise
- rollback or recovery path recorded before each mutation
- redacted post-change verification in Linear and GitHub

## Verification

Required local verification for this evidence:

```sh
pnpm secret:rotation:drill -- dry-run --strict
pnpm exec vitest run test/ops/secret-rotation-drill.test.ts test/security-docs.test.ts
pnpm check
pnpm lint
pnpm format
```

Broader PR verification should also include the full repository test suite and
`git diff --check` before merge.
