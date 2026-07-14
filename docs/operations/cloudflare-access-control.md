# Cloudflare Access-Control Review

Last reviewed: 2026-07-14.

Status: scoped tokens created; formal dry-run exists; remaining 2FA,
legacy-token, and break-glass gaps accepted temporarily.

This document records who and what can mutate HonoWarden Cloudflare resources.
It intentionally records only account/member hash tags, role names, counts,
permission group names, and operational decisions. It does not record member
email addresses, API token names, API token values, global key values, private
forwarding destinations, mailbox contents, or runtime secrets.

## Scope

Covered Cloudflare resources:

- account membership and account-level security settings
- user API tokens visible to the current operator account
- HonoWarden Workers, website Worker, D1 databases, R2 buckets, DNS records, and
  Email Routing
- local break-glass global key handling

Not covered:

- external auditor validation
- real credential rotation
- removal of existing user API tokens
- Cloudflare account member removal

Those actions are tracked by follow-up issues and must not be treated as
completed by this review.

## Redacted Readback

Readback command class: direct Cloudflare API read-only calls through local-only
direnv credentials.

Generated at: `2026-07-09T14:38:41Z`.

Account:

- Account tag: `eda2523850f9`
- Account type: `standard`
- Account settings readback keys: `abuse_contact_email`,
  `access_approval_expiry`, `api_access_enabled`, `enforce_twofactor`,
  `oauth_app_access_enabled`
- Account-level two-factor enforcement: `false`
- OAuth app access enabled: `true`

Members:

| Metric                                     | Value                                  |
| ------------------------------------------ | -------------------------------------- |
| Accepted members                           | `2`                                    |
| Super Administrator members                | `2`                                    |
| Distinct role names                        | `Super Administrator - All Privileges` |
| Members with two-factor flag read as false | `c42da818cfe9`, `9e3950e2bd59`         |

User API tokens visible to the current operator account:

| Metric                           | Value                                      |
| -------------------------------- | ------------------------------------------ |
| Active tokens                    | `7`                                        |
| Tokens without expiration        | `7`                                        |
| Duplicate token-name hash groups | `1ef4298540a5` x `2`, `e95d8e455da1` x `2` |

Observed permission group names across visible tokens:

- `Account Settings Read`
- `AI Gateway Read`
- `AI Gateway Run`
- `AI Gateway Write`
- `Browser Rendering Write`
- `CF Agents Write`
- `Cloudchamber Write`
- `Cloudflare One Connector: cloudflared Write`
- `Cloudflare One Networks Write`
- `D1 Write`
- `DNS Write`
- `Hyperdrive Write`
- `Load Balancing: Monitors and Pools Write`
- `Memberships Read`
- `Pages Write`
- `Pipelines Write`
- `Queues Write`
- `SSL and Certificates Write`
- `Secrets Store Write`
- `User Details Read`
- `Vectorize Write`
- `Workers AI Write`
- `Workers CI Write`
- `Workers Containers Write`
- `Workers KV Storage Write`
- `Workers Observability Write`
- `Workers R2 Storage Write`
- `Workers Routes Write`
- `Workers Scripts Write`
- `Workers Tail Read`

## Review Decision

The current account posture is not least privilege:

- two accepted members have Super Administrator access
- account-level two-factor enforcement is not enabled
- the current operator can see seven active user API tokens without expiration
- visible token permissions include broad write surfaces unrelated to the
  HonoWarden alpha path
- a home-directory global key remains as an explicit break-glass credential

Temporary acceptance:

- The existing member and token posture is accepted only for the current alpha
  operations window.
- No token or member removal was performed by this review because that is a
  control-plane mutation with account-wide blast radius.
- The local global key remains accepted only as a break-glass credential after
  scoped HonoWarden tokens are created and verified.
- Formal secret rotation dry-run coverage is tracked by `HON-60`; live
  break-glass rotation remains deferred to a separate operator-owned change
  window.

Follow-up:

- `HON-64`: create scoped tokens and document 2FA/no-expiry token expectations
- `HON-60`: formal dry-run secret rotation drill
- `HON-57`: independent security audit and external penetration test
- `HON-49`: external log sink and Cloudflare log retention access

## Least-Privilege Token Plan

Create separate scoped tokens instead of reusing the global key.

Routine Cloudflare workflows are scoped-token-only. The global key is never an
automatic or routine fallback.

| Token class        | Scope                                       | Allowed operations                                                                  | Must not allow                                             |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Deploy Worker      | HonoWarden API Worker and website Worker    | Worker script deploy, route attach, version/deployment readback                     | DNS write, Email Routing write, account membership write   |
| DNS and routes     | `honowarden.com` zone                       | DNS record read/write, route read/write for approved changes                        | D1/R2 data access, account membership write                |
| Email Routing      | `honowarden.com` zone                       | Email Routing settings/rules read/write, DNS readback for MX/SPF                    | Worker deploy, D1/R2 data access, account membership write |
| D1/R2 operations   | HonoWarden D1/R2 resources                  | D1 migration/readback, R2 object listing/backup/restore for approved drills         | DNS write, Email Routing write, account membership write   |
| Read-only evidence | account, zone, Worker, D1/R2, Email Routing | membership read, deployment read, DNS read, Email Routing read, D1/R2 metadata read | any write permission                                       |

Each scoped token must:

- have a clear owner
- have an expiration date
- be stored outside the repository
- be loaded through ignored local environment files or CI secrets only
- be documented by hash tag, owner role, scope, and expiration, never by value
- be revoked when no longer required

## Scoped Token Remediation Workflow

Repo-owned remediation tooling:

```sh
pnpm cloudflare:tokens -- plan
pnpm cloudflare:tokens -- apply --auth global
pnpm cloudflare:tokens -- apply --auth global --execute
pnpm cloudflare:tokens -- verify
```

The script manages five scoped account-token classes:

| Token class        | Local env var                               | Verification class                         |
| ------------------ | ------------------------------------------- | ------------------------------------------ |
| Deploy Worker      | `CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN`        | Worker services and Worker routes readback |
| DNS and routes     | `CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN`    | DNS records and Worker routes readback     |
| Email Routing      | `CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN` | Email Routing rules and DNS readback       |
| D1/R2 operations   | `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`         | D1 database and R2 bucket readback         |
| Read-only evidence | `CLOUDFLARE_HONOWARDEN_READONLY_TOKEN`      | account token and DNS readback             |

`CLOUDFLARE_API_TOKEN` may be used only as a command-local alias for the token
in the table. The two repo-code carve-outs for the global key are
`scripts/honowarden-cloudflare-token-remediation.mjs`, which bootstraps or
replaces these scoped tokens, and
`scripts/honowarden-secret-rotation-drill.mjs`, which inventories the explicit
break-glass rotation plan. The email preflight and ops-readiness packet reject
it. Direct Wrangler commands still inherit their shell environment, so operators
must remove global-key variables and bind only the workflow token; Wrangler
prefers complete global-key auth over an API token when both are present.

The account setting `OAuth app access enabled` in the redacted readback is not a
signal about local Wrangler authentication. Wrangler may also have a broad OAuth
session in its operator-owned auth profiles and may silently use it when
environment credentials are absent. The email preflight reports presence based
only on auth-profile filenames without opening or modifying profile contents.
While that warning is present, successful Wrangler execution cannot prove
scoped-only operation. An
operator who needs that proof must use a clean shell and run `wrangler logout`
for the default profile first. Named profiles must also be deactivated with
`wrangler auth deactivate` and removed with `wrangler auth delete <profile>` if
they remain. Repository scripts must not automate any of those mutations.

`apply --execute` creates missing tokens only, writes one-time token values to
`~/.config/honowarden/cloudflare-scoped.env` with mode `0600`, and prints only
token hash tags plus verification statuses. The generated values must be loaded
through ignored `.envrc.local` and must not be copied into Linear, GitHub,
docs, shell transcripts, or chat.

Account-level 2FA enforcement is intentionally not automated by this script.
The review observed accepted members whose two-factor flag read as false, so
turning on account-wide enforcement without an out-of-band operator check could
lock out an account owner. The expectation is:

1. every HonoWarden Cloudflare operator enables 2FA;
2. the member readback is repeated with only hash tags recorded;
3. account-level enforcement is enabled from a trusted human browser session or
   an explicit control-plane change window;
4. the resulting setting readback is recorded here without member emails.

## Post-Remediation Readback

Generated at: `2026-07-09T17:30:38Z`.

Executed commands:

- `pnpm cloudflare:tokens -- apply --auth global --execute --expires-on 2026-10-07T23:59:59Z`
- `pnpm cloudflare:tokens -- verify --strict`

Local secret storage:

- scoped token values were written to
  `~/.config/honowarden/cloudflare-scoped.env`
- file mode readback: `0600`
- ignored `.envrc.local` now sources the scoped token file
- ignored `.envrc.local` exports `CLOUDFLARE_API_TOKEN` to the read-only scoped
  token by default; write operations must override it command-locally
- token values were not printed, committed, or copied into Linear/GitHub/docs

Created scoped account tokens:

| Token class        | Token tag      | Expiration             | Verification readback                                         |
| ------------------ | -------------- | ---------------------- | ------------------------------------------------------------- |
| Deploy Worker      | `6342f7107d60` | `2026-10-07T23:59:59Z` | account-token verify, Worker services, Worker routes passed   |
| DNS and routes     | `378f715a142f` | `2026-10-07T23:59:59Z` | account-token verify, DNS records, Worker routes passed       |
| Email Routing      | `db2000584509` | `2026-10-07T23:59:59Z` | account-token verify, Email Routing rules, DNS records passed |
| D1/R2 operations   | `f9965cf7b00f` | `2026-10-07T23:59:59Z` | account-token verify, D1 databases, R2 buckets passed         |
| Read-only evidence | `e8af23942e60` | `2026-10-07T23:59:59Z` | account-token verify, account tokens, DNS records passed      |

Current redacted token inventory:

| Metric                                        | Value |
| --------------------------------------------- | ----- |
| Active account tokens                         | `7`   |
| Account tokens without expiration             | `2`   |
| Active HonoWarden scoped account tokens       | `5`   |
| HonoWarden scoped tokens without expiration   | `0`   |
| Visible active user tokens                    | `7`   |
| Visible active user tokens without expiration | `7`   |

Account/member hardening readback:

- Account-level two-factor enforcement remains `false`.
- Accepted members remain `2`.
- Super Administrator members remain `2`.
- The current member API response no longer exposes a per-member two-factor
  flag, so account-wide 2FA enforcement still requires a trusted human browser
  check before mutation.

Post-remediation decision:

- The five HonoWarden scoped account tokens replace the global key for normal
  deploy, DNS/routes, Email Routing, D1/R2, and read-only evidence work.
- The two older no-expiry account tokens and seven visible no-expiry user
  tokens are explicitly re-accepted only for the current operator-owned
  transition window. They must be reviewed and retired or renewed on the next
  access-control review.
- The global key remains stored outside the repository as a break-glass
  credential and is not loaded into routine shells.
- Account-level 2FA enforcement is documented as an operator action instead of
  being automated from this repository.

## Break-Glass Process

The break-glass path is the local-only global key stored outside the repository
under the operator home configuration. Load it only inside an isolated,
explicitly approved remediation or rotation window, then exit that shell.

Rules:

1. Use the global key only to remediate scoped tokens or perform an explicitly
   approved break-glass rotation drill. The email preflight and ops-readiness
   packet reject it; direct Wrangler commands require the clean-shell invariant.
2. Before use, record the reason, target resource, planned command, rollback
   command, and expected readback in Linear.
3. Do not print or paste the global key, account email, private forwarding
   destination, or resulting bearer material.
4. Prefer read-only commands first.
5. After use, record the Cloudflare deployment/configuration readback and the
   decision to continue, rollback, or hold.
6. Do not rotate the break-glass credential during a dry-run. Rotate it only in
   a separate operator-approved live change window.

## Stale Credential Decision

No stale credential was removed in this review.

Accepted temporary stale/broad credentials:

- seven visible active user tokens without expiration
- two Super Administrator members
- account-level two-factor enforcement disabled
- local global key break-glass credential

Reason for acceptance: removing or rotating these credentials could break
unrelated account automation and requires operator-owned sequencing. The scoped
HonoWarden token rollout reduces normal-operation reliance on broad credentials;
legacy token retirement, role reduction, and break-glass rotation must be
handled through an operator-owned live change window.

## Review Cadence And Owner

Owner: HonoWarden operator.

Cadence:

- before any production secret rotation
- before inviting non-operator users
- after any Cloudflare account member change
- after any Cloudflare token creation, removal, or scope change
- after any incident involving Cloudflare, DNS, Email Routing, D1, R2, Worker
  deploys, or website deploys
- at least quarterly while the project remains active

Minimum recurring review checklist:

1. Redacted account member count, role names, and two-factor enforcement state.
2. Redacted active token count, expiration coverage, duplicate name tags, and
   permission group names.
3. Confirm scoped-token coverage for deploy, DNS, Email Routing, D1/R2, and
   read-only evidence tasks.
4. Confirm the global key is either removed or still explicitly accepted as
   break-glass.
5. Confirm whether a local Wrangler OAuth session exists and do not claim
   scoped-only evidence from command success while it does.
6. Confirm Cloudflare log retention/access evidence status.
7. Record follow-up Linear issues for every unresolved gap.
