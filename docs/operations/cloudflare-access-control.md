# Cloudflare Access-Control Review

Last reviewed: 2026-07-09.

Status: reviewed with remediation gaps accepted temporarily.

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
- the local automation currently relies on a home-directory global key as a
  break-glass fallback

Temporary acceptance:

- The existing member and token posture is accepted only for the current alpha
  operations window.
- No token or member removal was performed by this review because that is a
  control-plane mutation with account-wide blast radius.
- The local global key remains accepted only as a break-glass credential until
  scoped HonoWarden tokens are created and verified.
- Secret rotation is intentionally deferred to the formal rotation drill tracked
  by `HON-60`.

Follow-up:

- `HON-64`: create scoped tokens, enforce or document 2FA expectations, and
  remediate no-expiry/broad user tokens
- `HON-60`: rotate and retire break-glass/global credentials after scoped token
  replacement exists
- `HON-57`: independent security audit and external penetration test
- `HON-49`: external log sink and Cloudflare log retention access

## Least-Privilege Token Plan

Create separate scoped tokens instead of reusing the global key.

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

## Break-Glass Process

The break-glass path is the local-only global key stored outside the repository
under the operator home configuration and loaded through ignored direnv files.

Rules:

1. Use break-glass only when scoped tokens are unavailable or broken.
2. Before use, record the reason, target resource, planned command, rollback
   command, and expected readback in Linear.
3. Do not print or paste the global key, account email, private forwarding
   destination, or resulting bearer material.
4. Prefer read-only commands first.
5. After use, record the Cloudflare deployment/configuration readback and the
   decision to continue, rollback, or hold.
6. Rotate the break-glass credential during the next formal rotation drill.

## Stale Credential Decision

No stale credential was removed in this review.

Accepted temporary stale/broad credentials:

- seven visible active user tokens without expiration
- two Super Administrator members
- account-level two-factor enforcement disabled
- local global key break-glass fallback

Reason for acceptance: removing or rotating these credentials could break
unrelated account automation and requires operator-owned sequencing. The risk is
recorded here and must be remediated by `HON-64` scoped-token rollout and the
formal secret rotation drill.

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
5. Confirm Cloudflare log retention/access evidence status.
6. Record follow-up Linear issues for every unresolved gap.
