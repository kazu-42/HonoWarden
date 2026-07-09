# Formal Secret Rotation Drill

Last reviewed: 2026-07-09.

Status: dry-run-supported. No real production secret value was rotated by this
drill.

This runbook coordinates HonoWarden secret rotation across runtime Worker
secrets, operator credentials, Cloudflare credentials, GitHub, Linear, and
Email Routing destinations. It complements the focused
[Access Token Key Rotation](access-token-key-rotation.md) and
[TOTP Secret Rotation](totp-secret-rotation.md) runbooks.

## Dry Run

Run the formal dry-run packet:

```sh
pnpm secret:rotation:drill -- dry-run --strict
```

Optionally write the JSON packet to an ignored or reviewable evidence path:

```sh
pnpm secret:rotation:drill -- dry-run --strict --out test/.tmp/secret-rotation-drill.json
```

The packet records:

- credential classes and environment variable names
- configured/missing status only, never values
- blast radius and rotation triggers
- command shapes for live rotation
- verification commands
- rollback/recovery paths
- global redaction and safety rules

It does not call Cloudflare, GitHub, Linear, Wrangler, or D1/R2 APIs. It does
not rotate, revoke, set, print, or persist any secret value.

Keep generated JSON packets out of commits unless an operator explicitly wants
to review the full environment-name/configured-state matrix. The committed
evidence should stay in Markdown and summarize only redacted status, command
shape, and live-mutation boundaries.

## Covered Secret Classes

The dry-run packet covers:

- bootstrap token
- refresh-token / legacy access-token `HONOWARDEN_TOKEN_SECRET`
- access-token staged keyring
- TOTP wrapping secret and TOTP rotation operator inputs
- scoped Cloudflare account tokens
- Cloudflare global-key break-glass fallback
- GitHub token or keychain-backed GitHub automation
- Linear API key
- private Email Routing forwarding destinations

## Live Rotation Rules

Use a separate operator-owned change window for any real rotation.

Required invariants:

1. Record the issue ID, owner, target environment, UTC timestamp, and affected
   credential class before mutation.
2. Capture read-only/dry-run evidence before mutation unless active compromise
   requires immediate containment.
3. Keep old credentials active until replacements verify, except when the old
   credential is confirmed compromised.
4. Do not paste secret values, bearer tokens, refresh tokens, previous-key JSON,
   private destination addresses, or Cloudflare global keys into evidence.
5. For D1/R2 or backup incidents, restore only into fresh targets.
6. For `HONOWARDEN_TOKEN_SECRET`, plan forced re-login because refresh-token
   hashes and legacy no-kid access-token verification are invalidated.
7. For `HONOWARDEN_TOTP_SECRET`, choose rewrap, backup recovery, or force
   re-enrollment before changing the runtime secret.
8. For Cloudflare global-key rotation, verify scoped tokens first and keep the
   global key as break-glass only.

## Verification Matrix

Minimum local checks before closing a dry-run drill:

```sh
pnpm secret:rotation:drill -- dry-run --strict
pnpm exec vitest run test/ops/secret-rotation-drill.test.ts test/security-docs.test.ts
pnpm check
pnpm lint
pnpm format
```

Live rotation windows add the focused checks from each credential class:

- access-token keyring: token domain/app tests plus live token exchange smoke
- TOTP wrapping: TOTP rotation dry-run, TOTP domain tests, and synthetic TOTP
  login smoke
- Cloudflare scoped credentials: `pnpm cloudflare:tokens -- verify --strict`
- Linear key: `pnpm linear:preflight -- --strict`
- GitHub credential: `gh auth status` and target repository readback
- Email destinations: `pnpm email:preflight -- --strict` plus redacted
  Cloudflare route readback

## Rollback

Rollback must be specific to the credential class:

- bootstrap token: restore prior token only if the bootstrap window remains
  approved; otherwise keep bootstrap disabled
- `HONOWARDEN_TOKEN_SECRET`: prefer continuing forced re-login over restoring
  an exposed secret
- access-token keyring: restore the last known-good active key and previous-key
  JSON
- TOTP wrapping: reverse rewrap before runtime secret change; after runtime
  change restore the prior runtime secret and reverse rewrap or restore from
  backup
- Cloudflare scoped tokens: keep previous scoped tokens active until
  replacements verify; revoke failed replacements only
- Cloudflare global key: no rollback after rotation; rely on verified scoped
  tokens and a trusted human session
- GitHub/Linear: keep old credential active until replacement preflight passes
- Email destinations: restore the prior verified destination or disable only
  the affected route

## Evidence

The 2026-07-09 dry-run evidence is recorded in
[Secret Rotation Drill Evidence](../release/secret-rotation-drill-evidence.md).
