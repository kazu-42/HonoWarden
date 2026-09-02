# Operator Quickstart & Capability Status

A concise prepare → verify → use → recover → limitations guide for HonoWarden operators.
It links the detailed runbooks rather than duplicating them, and ends with an honest
green/yellow/red capability table separating **synthetic‑usable** from **real‑secret‑ready**.

> Scope: this guide covers local verification and read-only staging / synthetic
> operation. Production real-secret activation (registration and real login
> signing keys) is deliberately **out of scope** here and requires a separately
> reviewed secret/config/deploy protocol — see
> [Capability status](#capability-status) and [Blockers & gates](#blockers--gates).
>
> Secret hygiene: never pass secrets on `argv`, and never let them reach logs,
> screenshots, or committed files. HonoWarden API Worker secret/config writes
> are currently **STOP** and have no executable example in this guide.

## 1. Prerequisites

- Two repos side by side: `HonoWarden` (vault server) and `HonoWarden-inquiry-inbox` (inquiry inbox worker).
- `pnpm`, `wrangler` (`npx wrangler`), `node`, and `direnv`.
- Cloudflare access — see [operator-environment.md](operator-environment.md) for `direnv` setup and required local values.
- A Cloudflare credential (see next section).

## 2. Scoped authentication

Routine workflows should use **scoped API tokens**, not the global key. See
[cloudflare-access-control.md](cloudflare-access-control.md).

- `CLOUDFLARE_API_TOKEN` (scoped) covers read and most routine calls.
- A future HonoWarden Worker deploy protocol reserves the dedicated
  `CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN`; current deploy entrypoints must not
  receive it. HonoWarden API Worker secret/config writes and deploy-token
  bootstrap are also STOP. A global key, Wrangler OAuth session, broad token,
  or explicit approval is never a fallback or bypass for those boundaries.

Retiring the global key and widening scoped-token coverage is tracked in
**HON-74**. Existing credentials may be inventoried read-only, but do not create,
replace, rotate, or retire a deploy token from this guide.

## 3. Deploy boundary (staging)

Vault server (`HonoWarden/`):

Vault Worker deployment is **REAL WORKER/VERSION/TRAFFIC WRITE STOP**. The
repository exposes only static blockers for deploy, deploy dry-run, and
automated recovery. They make no remote change and accept no credential. See
the [deployment authority runbook](deploy-provenance-runbook.md) for the runtime
provenance contract and the admission requirements for a future protocol.

Explicit approval alone does not unlock deployment or secret/config writes. A
future execution boundary must be a separately reviewed protocol that names the
exact Cloudflare account, environment, Worker/resource and configuration target;
binds the exact scoped credential while excluding ambient global-key and
Wrangler OAuth auth; captures secret-safe pre-readback; defines the ordered
mutation; verifies post-readback and provenance; classifies zero-write,
partial-success, and complete-success outcomes; and provides tested recovery
for every partial state. Staging and production remain separate decisions.

Inquiry inbox (`HonoWarden-inquiry-inbox/`):

The following is the exact separate-repository exception. It applies only from
the independently versioned `HonoWarden-inquiry-inbox/` checkout, under that
repository's own reviewed authority. It does not authorize a HonoWarden API
Worker deploy or secret/config write.

```bash
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy --env staging      # honowarden-inquiry-inbox-staging
```

Inquiry-inbox secret provisioning only (value on **stdin**, never argv):

```bash
printf '%s' "$SECRET_VALUE" | env -u CLOUDFLARE_API_TOKEN npx wrangler secret put NAME --env staging # HonoWarden-inquiry-inbox only
```

Before committing after any change, always run the gates: `pnpm check` (tsc), `pnpm lint`,
`pnpm test`, `pnpm format`, `pnpm brand:scan` (vault repo). `vitest` skips typecheck, so run
`pnpm check` separately.

## 4. Read-only health verification after an admitted deployment

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

After any future HonoWarden Worker deploy executed by the separately reviewed
protocol, read `/health`, `/healthz`, and
`/api/config`. **STOP** unless both health aliases report the intended
environment, a distinct `workerVersionId`, a valid `createdAt`, and the exact
reviewed commit in `build.gitSha`, with `/api/config.gitHash` equal to that SHA.

Inquiry worker health: `GET https://inbox-staging.honowarden.com/operator` redirects (`302`) to
Cloudflare Access when unauthenticated — that is the healthy protected state.

## 5. Official clients

Point an official upstream client (browser extension, desktop, mobile) at the server
URL. Compatibility is pinned against real client bundles — see
[compatibility-matrix.md](../compatibility-matrix.md) and
[compatibility.md](../compatibility.md). Bulk vault actions, premium TOTP/attachment surfaces, and
login‑with‑device are exercised with live‑client evidence. The ADR 0010 organization foundation and
owner-administered collection CRUD are source-verified slices, not broad official-client
compatibility. Organization membership/roles/cipher assignment/policies, Send, and Emergency
Access remain explicitly unavailable or unverified as documented in the compatibility boundary.

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

- **Code**: **REAL WORKER/VERSION/TRAFFIC WRITE STOP**. Preserve the exact
  provenance-enabled recovery target and follow
  [rollback-guide.md](../release/rollback-guide.md); this repository does not
  currently provide a code or traffic recovery writer.
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
| **Production real‑secret readiness**                   |       n/a        |        🔴         | Prod `Token exchange is not configured`, `ALLOWED_EMAILS=""`, bootstrap off | Reviewed secret/config/deploy protocol                                        |
| Operator 2FA + least‑privilege                         |        🔴        |        🔴         | HON‑101 inventory                                                           | Both operators Super Admin + 2FA off (HON‑73/102); scoped‑token gaps (HON‑74) |
| Independent security assessment                        |        🔴        |        🔴         | HON‑86 engagement pack ready                                                | Assessor not engaged (HON‑57/87/107)                                          |

## Blockers & gates

Ordered by what unblocks the most:

1. **Operator 2FA** (HON‑73/102) — both operators enable TOTP at
   `https://dash.cloudflare.com/profile/authentication` (additive, no lockout). Prerequisite for
   reducing Super Administrator to least‑privilege roles.
2. **Scoped-token coverage** (HON-74 prep) — inventory and validate existing
   credentials read-only. Deploy-token bootstrap remains STOP until it is part
   of the separately reviewed protocol described above.
3. **Independent security assessment** (HON‑107) — engage an external assessor (long lead time;
   start in parallel with 1–2). Engagement pack is ready (HON‑86).
4. **Production real-secret activation** — HonoWarden login signing keys,
   registration policy, and runtime configuration require the separately
   reviewed secret/config/deploy protocol described above; approval alone is not
   execution authority. Inquiry-inbox secrets remain governed by the exact
   separate-repository exception above.

_Do not execute credential rotation/retirement (HON-74/105). Scheduling or
approval alone does not replace the required reviewed protocol._
