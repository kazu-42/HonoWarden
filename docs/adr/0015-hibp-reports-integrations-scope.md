# ADR 0015: HIBP, Reports, Security Tasks, And Integrations Scope

## Status

Accepted

This decision extends ADR 0009's premium-surface guard. It does not replace that
runtime contract and does not claim that vault health, breach lookup, security
tasks, a notification center, or vendor integrations are supported at runtime.

## Context

Parity slice P2 (HON-200) asked whether HonoWarden should originate Have I Been
Pwned (HIBP) lookups, organization reports, at-risk password security tasks, a
notification center, or external event integrations.

Official clients mix two different data planes:

1. **Local client password-health.** The pinned browser extension
   `web-v2026.6.1` (`39f07436ca60e3f25eac47777671754f288a98f1`) decrypts the
   vault on the device, then performs weak-password evaluation, reused-password
   evaluation, an unsecured-website report, and an inactive two-factor report
   locally. Its manual exposed-password check calls the Pwned Passwords range
   API at `api.pwnedpasswords.com/range` with a SHA-1 prefix (k-anonymity). The
   Worker does not receive password plaintext, does not receive password hashes,
   and does not add HonoWarden routes for those flows.
2. **Server-origin breach lookup.** The pinned server `v2026.6.1`
   (`a09c7edb03ae6d4fdece784f1250c67be73d5fe0`) `HibpController` implements
   authenticated `GET /api/hibp/breach?username=...` by forwarding the username
   to `haveibeenpwned.com/api/v3/breachedaccount` with an HIBP API key. That is
   third-party disclosure of an account identifier, plus vendor rate-limit,
   false-positive, and vendor retention consequences. ADR 0009 already returns
   a state-free HTTP `501` for this route.

Server-side password-health aggregation, at-risk password security tasks, and a
product notification center would require either plaintext, client-uploaded
password-derived material, or a vendor lookup. Those are not equivalent to
encrypted-metadata organization reports or the existing vault-sync notification
hub at `/notifications/hub`.

## Decision

Keep local client password-health on the client. Keep server-origin HIBP,
vendor-dependent reports, at-risk password security tasks, and a notification
center as explicit non-goals unless a later privacy/security ADR and operator
opt-in are accepted. This slice's implementation rules are: do not call
HaveIBeenPwned, do not add vendor API keys, and do not contact vendors.

### Local Client Password-Health (Accepted, No Server Processing)

The following remain client-owned and do not add HonoWarden routes:

| Client behavior               | Server data                                    | Provider                                          |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| weak-password evaluation      | none; client scores decrypted secrets          | none                                              |
| reused-password evaluation    | none; client compares decrypted secrets        | none                                              |
| unsecured-website report      | none; client inspects decrypted URIs           | none                                              |
| inactive two-factor report    | none; client inspects decrypted login metadata | optional public 2FA catalog fetched by the client |
| manual exposed-password check | none; client sends a SHA-1 prefix              | Pwned Passwords range API                         |

HonoWarden does not proxy, cache, or attest those results.

### Server-Origin HIBP (Explicit Non-Goal)

`GET /api/hibp/breach` remains the ADR 0009 state-free HIBP 501 guard:

- no authentication, D1, R2, or object-storage work for this route family;
- no `HONOWARDEN_HIBP_API_KEY` binding, Wrangler var, or secret;
- the username query is ignored and must not be echoed, stored, or forwarded;
- optional global ingress quota may still apply as a shared Worker control, but
  that is not HIBP-specific state.

Server-origin lookup would disclose identifiers to HaveIBeenPwned
breachedaccount, inherit vendor rate-limit and false-positive quality, and
create vendor retention outside HonoWarden's D1/R2 lifecycle. Reconsideration
requires a new privacy/security ADR, an operator opt-in that stays default-off,
a provider adapter with failure and audit policy, and evidence that the current
501 guard is intentionally replaced.

### Reports And Security-Task Inventory

| Surface                                                                                                             | Data boundary                                                                   | Decision                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| weak / reused / unsecured / inactive-2FA reports                                                                    | client plaintext after local decrypt                                            | accepted as local client password-health                         |
| exposed-password report via Pwned Passwords range API                                                               | client k-anonymity prefix only                                                  | accepted as local client password-health                         |
| Data Breach report / server-origin breach lookup                                                                    | account username to HaveIBeenPwned                                              | explicit non-goal                                                |
| member access report                                                                                                | encrypted metadata: membership, role, collection assignment                     | candidate only; no route in this slice                           |
| collection access report                                                                                            | encrypted metadata: collection users and permissions                            | candidate only; no route in this slice                           |
| organization event export                                                                                           | existing audit_events metadata, no vault plaintext                              | candidate only; operator-owned                                   |
| at-risk password security tasks (`GET /tasks`, `POST /tasks/{orgId}/bulk-create`, `PATCH /tasks/{taskId}/complete`) | requires exposed-password knowledge or client-uploaded secret-derived task rows | explicit non-goal                                                |
| notification center                                                                                                 | product inbox for at-risk tasks and admin messages                              | explicit non-goal; distinct from the vault-sync notification hub |
| `/notifications/hub`                                                                                                | already-implemented metadata-only vault-sync push                               | unchanged                                                        |
| vendor SIEM adapter, Slack integration, HIBP API key                                                                | third-party disclosure of identity or events                                    | explicit non-goal                                                |

Organization-family paths such as `/api/organizations/:id/events` and
`/api/organizations/:id/integrations` stay under the existing typed
unsupported-feature guard. Dedicated `/api/tasks` and `/api/reports` routes are
not added; they continue to miss as `404 not_found` rather than looking like a
supported empty list.

### Explicit Non-Goals

Plaintext-requiring or vendor-dependent features remain explicit non-goals
unless a privacy/security ADR and operator opt-in are accepted:

- server-origin breach lookup and any HaveIBeenPwned breachedaccount proxy;
- storing, hashing, or ranking vault passwords on the server;
- at-risk password security tasks and a notification center driven by those
  tasks;
- vendor SIEM adapter, Slack integration, or other outbound identity webhooks;
- tracked `HONOWARDEN_HIBP_API_KEY` or other vendor credentials.

Those rules stay in force: do not call HaveIBeenPwned, do not add vendor API
keys, and do not contact vendors.

### Accepted Capability Decomposition

Each accepted capability is decomposed by data boundary, provider adapter,
failure policy, audit, retention, and rollback:

| Capability                              | data boundary                                                            | provider adapter                                                            | failure policy                                                                             | audit                                                               | retention                                      | rollback                                                         |
| --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| local client password-health            | client-only decrypted vault; server sees no password plaintext or hashes | none on the Worker; clients may call the Pwned Passwords range API directly | client UX only; server has no health-report route to fail                                  | none                                                                | none                                           | none; no server state                                            |
| state-free HIBP 501 guard               | request path and request id only; username is not processed              | none                                                                        | HTTP `501` `unsupported_feature` with client-readable `Message`; `Cache-Control: no-store` | none for this route                                                 | none                                           | git revert of the guard; no data migration                       |
| encrypted-metadata organization reports | membership, role, and collection assignment already stored as metadata   | none; future read adapters must not decrypt cipher JSON                     | explicit `501` / `404` until a later slice designs the report contract                     | reuse existing redacted `audit_events` policy; no new secret fields | existing D1 audit retention                    | git revert of any later report route; no HIBP or password tables |
| operator-owned audit event export       | existing `audit_events` rows without vault payloads                      | none in this slice; no vendor SIEM adapter                                  | fail closed if a future exporter lacks an operator opt-in                                  | export itself must be audited without copying secrets               | existing audit retention; no extra vendor copy | disable the exporter; no remote vendor delete API is assumed     |

No accepted capability in this slice adds a provider adapter, D1 table, R2
object, or tracked secret.

## Consequences

- Official clients keep local password-health tools. Server-origin Data Breach
  lookup, at-risk password security tasks, and a notification center remain
  unavailable.
- `GET /api/hibp/breach` continues to return the ADR 0009 501 contract and
  persists no HIBP-specific state.
- Encrypted-metadata member/collection reports and operator-owned audit export
  may be designed later without this ADR being reopened, provided they stay
  inside the decomposition above and never require plaintext or a vendor.
- Reconsidering server-origin HIBP or any vendor-dependent feature requires a
  new privacy/security ADR, default-off operator opt-in, rate-limit and
  false-positive handling, vendor retention and rollback evidence, and
  replacement of the 501 guard. That work is out of scope here.
- Compatibility rows are not promoted. There is no HIBP live evidence and HIBP
  is not supported at runtime.
