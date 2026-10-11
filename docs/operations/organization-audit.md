# Organization audit history

This HonoWarden-owned API reads committed organization administration events:
membership transitions, groups, and required-TOTP policy changes.
It does not implement the upstream numeric Events API; organization `UseEvents`
remains false. Source tests and local synthetic runs do not activate a staging
or production route and do not admit real secrets.

## Authority and availability

`HONOWARDEN_ORGANIZATION_AUDIT_ENABLED` is default-off in tracked environments.
When false, query and export return `501 unsupported_feature`. This flag does
not enable membership writers or optional `HONOWARDEN_AUDIT_LOGS` emission.

Each enabled query/export checks the current database state: the actor must be
a confirmed Owner or Admin, the account must be active, and the same requested
organization must be enabled. An Admin may read Owner/Admin transition metadata;
its mutation permissions remain governed separately. An enabled required-TOTP
policy also requires the exact current device/session to carry verified
assurance for the current TOTP credential generation. Enrollment or an old
token's `amr` claim alone does not authorize the read.
Even when the policy is absent or disabled, the selecting SQL requires the exact
authenticated device/session family to exist and remain unrevoked. HTTP
authentication cannot authorize a family revoked before the subsequent SQL read.

The authorization and event selection execute in the same D1 statement on every
page and export. A cursor is not authority. Role changes, revoked membership,
account/organization disabling, device revocation or replacement, and TOTP
generation changes can refuse a subsequent page.

Migration `0028_organization_audit_scope_index.sql` is required. The query forces
`idx_organization_audit_scope_occurred`; absent schema/index fails with a reported
`503`, without an unindexed or operator/global fallback. Cursor signing uses
the injected existing server signing secret, requiring at least 32 UTF-8 bytes.
Source integration adds no remote secret mutation.

## Recorded scope and limitations

The supported durable event names are:

- `organization.member.invite`
- `organization.member.reinvite`
- `organization.member.registration`
- `organization.member.accept`
- `organization.member.confirm`
- `organization.member.update`
- `organization.member.revoke`
- `organization.member.remove`
- `organization.group.create`
- `organization.group.update`
- `organization.group.delete`
- `organization.group.member.remove`
- `organization.policy.update`
- `organization.settings.update`
- `organization.mail_test.request`

Each supported successful membership mutation commits its required audit row
atomically in the same D1 batch, even when optional audit logging is false.
Invited account registration also commits its required audit row with the account.
Group and required-TOTP policy mutations follow the same mandatory transaction
boundary. Event and target types must match exactly: member events target
`organization_user`, group events target `organization_group`, and policy,
settings, and test-mail events target `organization`.
An invite/reinvite event proves persisted invitation state, not successful mail
delivery. Acceptance identifies the recipient as actor. Refused transitions do
not produce these successful events. Update events do not contain a complete
before/after role or grant snapshot.

The exact event-time `context.organizationId` supplies organization scope.
Deleted target members and deleted actors retain historical identifiers. A
current target/actor membership or cipher join never supplies attribution.
Malformed, unscoped, unknown-schema/name, wrong-target, and unsupported-outcome
records are excluded from this product API.

Existing optional cipher audit rows do not retain event-time organization scope,
so they are excluded. The API does not promise complete company activity,
authentication activity, vault reads/decryptions, denied attempts, organization
creation, collection changes, export download events, or invitation delivery.
Group deletion retains the original group target identifier in audit history;
policy events describe committed policy changes rather than proving every
subsequent authentication decision.

Responses expose opaque audit/actor/target IDs, event name, successful outcome,
timestamp, and schema version. They omit raw context, request IDs, device IDs,
user/recipient names and emails, IP addresses, keys, token verifiers, collection
names, encrypted values, and vault payloads. Audit rows and exports still contain
sensitive operational metadata.

## Querying

`GET /api/organizations/:id/audit-events` accepts:

| Parameter           | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `from`              | Inclusive canonical UTC ISO timestamp, including milliseconds |
| `to`                | Exclusive canonical UTC ISO timestamp                         |
| `eventName`         | Optional exact supported event name                           |
| `actorUserId`       | Optional exact opaque actor ID                                |
| `limit`             | Canonical integer 1..100, default 50                          |
| `continuationToken` | Signed bounded cursor returned by the previous page           |

For example, use `from=2026-10-01T00:00:00.000Z` and
`to=2026-10-04T00:00:00.000Z`. Bounds form a half-open interval; an event exactly
at `to` is excluded. Missing initial dates resolve once to a seven-day window
ending at the current server time. The maximum window is 31 days, the end cannot
be in the future, and duplicate, unknown, empty, or unsupported parameters are
rejected. There is no outcome filter because this catalog records successful
committed transitions only.

The JSON list contains `data`, `continuationToken`, effective `query`, and
`availability`. Records are ordered by `occurredAt DESC, id DESC`. The cursor
is signed with a distinct organization-audit purpose and binds actor,
organization, window, filters, limit, and last position. It expires 15 minutes
after the initial page; subsequent pages do not extend that expiry.

A continuation request may contain just `continuationToken`; omitted filters
and dates restore from the signed token. Explicit values must equal the signed
effective query. Cross-organization/actor use, tampering, changed filters/limit,
unknown versions, and expiration return `400 invalid_request`. Changing the
server signing secret invalidates transient cursors; restart the same window.

The window is fixed, but pages do not share a transaction snapshot. Retention
and late insertion can change records between requests. Stable keyset ordering
avoids duplicates/skips under unchanged data; it is not an immutable export
snapshot across pages.

`availability.coverage` is `partial`, with required transactional successful
administration coverage and `recordedActivity: committed_organization_administration`.
`optionalAuditLoggingEnabled` reports the current optional
flag only; `optionalAuditLoggingHistory` is `unknown`. A true flag does not imply
historical completeness or scope the excluded cipher rows. Empty data means no
supported records matched the window, not that no company activity occurred.

## CSV export

`GET /api/organizations/:id/audit-events/export` accepts the same `from`, `to`,
`eventName`, and `actorUserId` filters. It rejects `limit` and
`continuationToken`. It selects the full supported result for that bounded
window in one authorized statement, probing 1,001 rows.

Up to 1,000 rows produce a complete CSV; more return JSON
`413 audit_export_too_large` before any CSV bytes or download headers. Narrow the
window or filter. No partial file, streaming success, or unbounded pagination
loop is used.

The controlled filename is `honowarden-organization-audit.csv`, with media type
`text/csv; charset=utf-8`. Fixed columns are:

```text
id,occurredAt,name,outcome,actorUserId,targetType,targetId
```

All cells are quoted, quotes are doubled, records use CRLF, and null is an empty
cell. Formula-leading values receive a single-quote prefix, including leading
whitespace/control variants of `=`, `+`, `-`, and `@`. Quoting alone does not
prevent spreadsheet formulas.

`Cache-Control: no-store` and `X-Content-Type-Options: nosniff` apply to both
routes. Export headers include `X-HonoWarden-Audit-Coverage`, current optional
logging state, effective From/To, exact row count, and retention policy days.
The product must show partial coverage before download.

## Failure, retention, and rollout

Both missing and denied organizations return the same
`404 organization_not_found`. Authentication retains the shared `401` contract.
Invalid queries/cursors return `400`; enabled missing signing configuration
returns reported `503 server_misconfigured`; unexpected D1/schema/projection
failures return reported `503 organization_audit_unavailable`. Infrastructure
failures never become successful empty history, and operational reporting omits
raw errors, SQL, query/filter values, cursor tokens, and audit rows.

Audit retention remains 365 days with at most 100 expired rows removed per
cleanup run. This is a retention policy, not a guarantee that a cleanup backlog
contains no older rows. Query/export changes do not rewrite or delete history.

Remote migration, flag activation, secret configuration, deployment, and real
company use require the separately reviewed exact staging repair/admission
protocol. Source/CI, runtime/schema/index, current flags/mail, clients, restore,
and real-secret acceptance remain separate evidence. Roll back the read feature
by disabling its flag or using a compatible earlier reader; retain the additive
index and required membership audit rows.
