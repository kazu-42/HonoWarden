# Operator Quickstart & Capability Status

A concise deploy → verify → use → recover → limitations guide for HonoWarden operators.
It links the detailed runbooks rather than duplicating them, and ends with an honest
green/yellow/red capability table separating **synthetic‑usable** from **real‑secret‑ready**.

> Scope: this guide covers **staging / synthetic operation**. Production real‑secret
> activation (registration, real login signing keys, real inquiry secrets) is deliberately
> **out of scope** here and is gated behind a separate authorized issue — see
> [Capability status](#capability-status) and [Blockers & gates](#blockers--gates).
>
> Secret hygiene: never pass secrets on `argv`, and never let them reach logs, screenshots,
> or committed files. Provide secrets to `wrangler secret put` on **stdin** only (examples below).

## 1. Prerequisites

- Two repos side by side: `HonoWarden` (vault server) and `HonoWarden-inquiry-inbox` (inquiry inbox worker).
- `pnpm`, `wrangler` (`npx wrangler`), `node`, and `direnv`.
- Cloudflare access — see [operator-environment.md](operator-environment.md) for `direnv` setup and required local values.
- A Cloudflare credential (see next section).

## 2. Scoped authentication

Routine workflows should use **scoped API tokens**, not the global key. See
[cloudflare-access-control.md](cloudflare-access-control.md).

- `CLOUDFLARE_API_TOKEN` (scoped) covers read and most routine calls.
- Some operations still need broader rights than the current scoped token grants
  (DNS **write**, `wrangler deploy`, `wrangler secret put`). Those currently fall back to the
  **global key break‑glass path** (`CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY`). wrangler picks up
  the global key when the scoped token is unset for that command:

  ```bash
  env -u CLOUDFLARE_API_TOKEN npx wrangler <deploy|secret put|...> --env staging
  ```

  Retiring the global key and widening scoped‑token coverage is tracked in **HON‑74** (deferred
  until the user schedules rotation). Until then the global key is the emergency path — treat it
  as such.

## 3. Deploy (staging)

Vault server (`HonoWarden/`):

```bash
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy --env staging      # honowarden-staging
```

Inquiry inbox (`HonoWarden-inquiry-inbox/`):

```bash
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy --env staging      # honowarden-inquiry-inbox-staging
```

Provisioning a worker secret (value on **stdin**, never argv):

```bash
printf '%s' "$SECRET_VALUE" | env -u CLOUDFLARE_API_TOKEN npx wrangler secret put NAME --env staging
```

Before committing after any change, always run the gates: `pnpm check` (tsc), `pnpm lint`,
`pnpm test`, `pnpm format`, `pnpm brand:scan` (vault repo). `vitest` skips typecheck, so run
`pnpm check` separately.

## 4. Health verification

Run these against the target host with a browser‑like `User-Agent` (staging enforces a Browser
Integrity Check — non‑browser UAs get a `403 error code: 1010` before reaching the Worker).

```bash
UA="HonoWarden-Health/1.0"
BASE="https://honowarden-staging.ghive42.workers.dev"      # vault staging
curl -s -o /dev/null -w "GET / -> %{http_code}\n" -H "User-Agent: $UA" "$BASE/"
# prelogin (correct path is /identity/accounts/prelogin; /api/accounts/prelogin is 404)
curl -s -o /dev/null -w "prelogin -> %{http_code}\n" -X POST -H "User-Agent: $UA" \
  -H "Content-Type: application/json" --data '{"email":"nobody@example.test"}' \
  "$BASE/identity/accounts/prelogin"
```

Healthy staging returns `200` for `/` and processes token requests (`400 invalid_grant` for bad
creds). A `503 server_misconfigured: Token exchange is not configured` means the login signing key
is not configured for that environment — expected on **production** today (not real‑secret‑ready),
a real problem on **staging**.

Inquiry worker health: `GET https://inbox-staging.honowarden.com/operator` redirects (`302`) to
Cloudflare Access when unauthenticated — that is the healthy protected state.

## 5. Official clients

Point an official upstream client (browser extension, desktop, mobile) at the server
URL. Compatibility is pinned against real client bundles — see
[compatibility-matrix.md](../compatibility-matrix.md) and
[compatibility.md](../compatibility.md). Bulk vault actions, premium TOTP/attachment surfaces, and
login‑with‑device are exercised with live‑client evidence; unsupported surfaces (organizations,
collections, Send, emergency access) fail as explicitly unavailable.

## 6. Inquiry inbox loop

Inbound mail → AI triage draft → **human‑approved** reply, delivered via **Resend**. Full detail:
[ai-inquiry-inbox.md](ai-inquiry-inbox.md).

- Operators review/approve/send in the redacted operator queue (`/operator`, Cloudflare Access
  authenticated). The queue is metadata‑only: no recipient address, body, or raw provider response.
- Approval and send require a **human** Access identity; the service identity can create drafts but
  cannot approve or send. AI drafts carry a redacted pending‑recipient sentinel that blocks
  approval until an operator replaces it with an approved recipient.
- Outbound delivery uses Resend (`HONOWARDEN_RESEND_API_KEY` secret) from the verified
  `honowarden.com` domain; failures map to structural codes without reading provider bodies.

## 7. Backup & restore

Backup/restore tooling and the drill cadence are in [backup-restore.md](backup-restore.md). Run the
CLI dry‑run first; note that three `test/ops/backup-cli.test.ts` cases require a loopback listener
and time out (~30s) in restricted sandboxes — that is an environment limitation, not a tool failure.

## 8. Rollback

- **Code**: `git revert <commit>` then redeploy the affected worker. All recent changes are additive
  and revert cleanly (no schema migration in the outbound/Resend or R2‑cleanup work).
- **DNS**: snapshot records before edits; Cloudflare DNS is API‑reversible (create/delete by record id).
- **Secrets/keys**: rotation and break‑glass recovery are gated — see
  [secret-rotation-drill.md](secret-rotation-drill.md) and
  [access-token-key-rotation.md](access-token-key-rotation.md). Keep exactly one tested emergency
  path before removing any credential; stop on lockout or ownership ambiguity.

## Capability status

Legend: 🟢 working with evidence · 🟡 works in synthetic/staging but not real‑secret‑ready or
flagged off in production · 🔴 not yet available / blocked. "Synthetic‑usable" = proven with
synthetic accounts/data; "Real‑secret‑ready" = safe for real users/secrets in production.

| Capability                                             | Synthetic‑usable | Real‑secret‑ready | Evidence                                                                    | Blocker                                                                       |
| ------------------------------------------------------ | :--------------: | :---------------: | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Vault CRUD + official clients (browser/desktop/mobile) |        🟢        |        🟡         | HON‑52/53/54, live‑client evidence                                          | Prod login signing key not configured                                         |
| Bulk cipher ops (move/trash/restore/permanent‑delete)  |        🟢        |        🟡         | HON‑127 (staging 200s)                                                      | Prod real‑secret activation                                                   |
| Attachment permanent‑delete R2 reclamation             |        🟢        |        🟢         | HON‑128 (762/762 tests; staging+prod deployed)                              | — (existing orphans need a separate reclaim pass)                             |
| Premium surfaces (TOTP, attachments)                   |        🟢        |        🟡         | HON‑121/122/124/125                                                         | Prod `HONOWARDEN_PREMIUM_FEATURES_ENABLED=false`                              |
| Login‑with‑device / auth requests                      |        🟢        |        🟡         | HON‑72/80/85/88                                                             | Prod `HONOWARDEN_AUTH_REQUESTS_ENABLED=false`                                 |
| Inquiry inbox loop (inbound→triage→approve→reply)      |        🟢        |        🟢         | HON‑91, HON‑99 (human‑approved send), HON‑129                               | — (deployed staging+production)                                               |
| Outbound email via Resend                              |        🟢        |        🟢         | HON‑129 (Resend Sent→Delivered)                                             | —                                                                             |
| Backup / restore                                       |        🟢        |        🟡         | HON‑5/42/111                                                                | Prod backup evidence + `HONOWARDEN_AUDIT_LOGS`                                |
| Audit events + retention cleanup                       |        🟢        |        🟡         | HON‑47/48/51                                                                | Prod `HONOWARDEN_AUDIT_LOGS=false`                                            |
| **Production real‑secret readiness**                   |       n/a        |        🔴         | Prod `Token exchange is not configured`, `ALLOWED_EMAILS=""`, bootstrap off | Separate authorized activation issue                                          |
| Operator 2FA + least‑privilege                         |        🔴        |        🔴         | HON‑101 inventory                                                           | Both operators Super Admin + 2FA off (HON‑73/102); scoped‑token gaps (HON‑74) |
| Independent security assessment                        |        🔴        |        🔴         | HON‑86 engagement pack ready                                                | Assessor not engaged (HON‑57/87/107)                                          |

## Blockers & gates

Ordered by what unblocks the most:

1. **Operator 2FA** (HON‑73/102) — both operators enable TOTP at
   `https://dash.cloudflare.com/profile/authentication` (additive, no lockout). Prerequisite for
   reducing Super Administrator to least‑privilege roles.
2. **Scoped‑token coverage** (HON‑74 prep) — provision scoped tokens covering deploy/DNS/Email
   Routing/D1/R2 so the global‑key break‑glass path can be retired.
3. **Independent security assessment** (HON‑107) — engage an external assessor (long lead time;
   start in parallel with 1–2). Engagement pack is ready (HON‑86).
4. **Production real‑secret activation** — configure login signing key, registration policy, and
   real inquiry secrets. **Separately authorized**; not covered by this quickstart.

_Do not execute credential rotation/retirement (HON‑74/105) until the user explicitly schedules it._
