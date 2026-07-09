# Week 26 Formal secret rotation dry-run

## Goal

Close `HON-60` by adding a formal, repository-owned secret rotation dry-run
that covers HonoWarden runtime secrets, operator credentials, Cloudflare
credentials, GitHub, Linear, and Email Routing destinations without mutating
live systems or rotating real secrets.

## Success Criteria

- `pnpm secret:rotation:drill -- dry-run --strict` emits JSON only and exits
  successfully.
- Output records credential classes, environment variable names,
  configured/missing booleans, blast radius, live rotation shape, verification,
  rollback, and global redaction rules.
- Output never prints secret values, private forwarding destinations, bearer
  tokens, TOTP plaintext, encrypted payloads, or mailbox content.
- Docs distinguish formal dry-run completion from live secret rotation.
- Security, current-state, Cloudflare access-control, and release evidence docs
  point to the dry-run evidence.
- Local tests prove the command is non-mutating and secret-safe.

## Current Context

- The operator explicitly deferred real rotation for this pass.
- Scoped Cloudflare tokens exist and are verified for normal operations.
- Existing access-token and TOTP runbooks cover narrower credential classes.
- Incident response tabletop evidence still needs a formal secret rotation
  dry-run artifact to remove `HON-60` from the open gap list.

## Constraints

- Do not rotate, revoke, create, delete, or change any real credential.
- Do not call Cloudflare, GitHub, Linear, Wrangler, D1, R2, or Email Routing
  from the drill CLI.
- Do not print secret values or private email destinations.
- Do not convert dry-run evidence into a claim of production readiness.

## Risks

- A dry-run could be mistaken for a live rotation if docs are imprecise.
- Credential values could leak if tests only assert happy-path structure.
- Closing `HON-60` must not hide remaining 2FA, stale-token, global-key, or
  external audit gaps.

## Approval Required

No additional approval is required for this local dry-run. Real rotation,
credential revocation, account 2FA enforcement, or Cloudflare global-key
changes require a separate operator-owned change window.

## Work Packets

- `01-cli`: add the non-mutating dry-run CLI and package script.
- `02-docs`: add runbook, release evidence, workflow artifact, and update
  security/current-state references.
- `03-tests`: assert output contract, redaction, write-to-file behavior, and
  documentation boundaries.
- `04-closeout`: run local verification, PR/CI/merge, and update Linear.

## Integration Policy

Keep the implementation repo-local and auditable. If any check would require
live mutation, record it as a future live-window step instead of running it.

## Verification

- `pnpm secret:rotation:drill -- dry-run --strict`
- `pnpm secret:rotation:drill -- dry-run --strict --out test/.tmp/secret-rotation-drill.json`
- `pnpm exec vitest run test/ops/secret-rotation-drill.test.ts test/security-docs.test.ts`
- `pnpm test`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/week-26-secret-rotation-drill`
- `git diff --check`

## Reusable Artifacts

The dry-run JSON packet is the reusable checklist for a future live credential
rotation window. It can be regenerated without reading or mutating external
systems.
