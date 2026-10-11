# Company Administration Operator Contract

Status: the 2026-10-04 company administration implementation contract. Source
commit delivery, migration of a target runtime, feature activation, and actual
Browser/Desktop acceptance remain unresolved until the coordinator records their
individual evidence. This document supplies local verification commands and the
runtime requirements; it is not a deployment result. The service remains pre-alpha
and local fixtures use synthetic accounts and data.

The architecture and security decisions are in
[ADR 0016](../adr/0016-company-administration.md). Check the
[current state](../current-state.md) and [release index](../release/index.md) for
the final source, runtime, and exact-client outcomes. Historical CLI smoke evidence
does not promote the current company Browser or Desktop flows.

Use the [company recovery and identity decision](company-recovery-and-idp.md)
for lost-password/factor limits, replacement-account provisioning, restore
authorization reconciliation, and the later IdP, residency, and retention choices.

## Supported Company Slice

The original `/admin/` browser supports organization creation, invitation and
acceptance, recipient-specific encrypted key confirmation, supported member roles,
direct collection assignment, collection names, groups, required TOTP policy,
and bounded administration audit. It uses the authenticated `/api/` and
`/identity/` APIs. The user selected email, master password, and TOTP first, with
SSO later, and acceptance in the current pinned Browser extension and Desktop.

Invited users can choose account creation on the invitation landing page. Their
browser Worker derives PBKDF2 with 600,000 iterations and creates the encrypted
user and RSA private-key envelopes; plaintext passwords and keys are never sent
to the registration API. `POST /api/accounts/register-invited` requires both
`HONOWARDEN_INVITATION_REGISTRATION_ENABLED` and
`HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED` to be `true`, with the existing
invitation secret configured. The new flag is default-off in all tracked profiles.
An atomic insertion requires the exact unexpired invitation, email, enabled
organization, and pending unbound membership. Existing accounts are never
overwritten, including concurrent submissions. The account is not automatically
email-verified, enrolled in TOTP, signed in, or granted organization keys. The
recipient must sign in, satisfy any required TOTP policy, and accept the invitation;
the manager then confirms the wrapped organization key. An ambiguous registration
transport failure must not automatically replay creation: try signing in with the
chosen credentials to establish whether it committed.

The company browser is not a full personal Web Vault. IdP/SSO, SCIM, custom roles,
every vendor policy, passkey authentication, organization takeover, and recovery-key
envelopes are deferred. Existing WebAuthn enrollment endpoints do not establish
passkey login support. The browser has no plaintext vault-secret download.
Audit CSV contains a bounded metadata projection only.

The user's launch requirements include the Brave browser extension and both
Windows and macOS Desktop. CLI acceptance does not replace either Desktop target.
Company name, membership, administrator assignment, and onboarding values belong
in the dashboard setup flow rather than an operator questionnaire. The existing
organization creation and invitation UI now includes invitation-bound new-account
registration. Editable company settings and the initial operator setup still need
their own tested source and runtime evidence before the complete self-service
flow can be called ready.

On 2026-10-11 JST, a fresh synthetic Brave run created the recipient through that
registration UI and passed all 16 company flows, including approval, shared-key
decryption, TOTP remediation, offboarding, audit export, and a fresh D1/R2 restore.
The unmodified CLI 2026.9.1 decrypted personal attachments and the surviving
group-only member's shared data across three restored Worker restarts. The
173-file runtime source fingerprint was
`c4286f437b70fdd9c788a608b6ffa7f6b665f15f2a2108fbfc9da1611063b095`;
the before/after fingerprints matched and all owned processes closed. This is
local synthetic evidence, with private invitation delivery captured in memory;
it does not establish real mailbox receipt, deployed configuration, browser
extension acceptance, or either required Desktop client's acceptance.

## Personal Attachment Downloads

Official CLI 2026.9.1 requests JSON metadata from
`GET /api/ciphers/:id/attachment/:attachmentId`, then fetches its absolute `url`
without a vault Authorization header. The pinned upstream source at tag
`cli-v2026.9.1` defines this in `apps/cli/src/commands/get.command.ts` and
`apps/cli/src/commands/download.command.ts`.

The metadata route requires the normal authenticated session. Its URL contains a
purpose-specific HMAC capability expiring after 120 seconds, scoped to one origin,
personal cipher, attachment revision, user, device, session family, and credential
generation. Fetching the binary rechecks that session, active account, personal
cipher ownership, non-trashed state, and attachment metadata. Revoked sessions and
deleted attachments cannot continue downloading with a previously issued URL.
This capability is not an access token and cannot authenticate vault APIs.
Both responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Encrypted bytes are always served as an attachment with an octet-stream type.

Use the access-token keyring's active and previous keys for rotation; the download
MAC has a separate purpose domain. Removing a key invalidates its outstanding
URLs. A client can request new metadata after expiry or key retirement. Keep full
download URLs, query strings, and response bodies out of operator logs and error
reports: the URL is a short-lived capability. Missing R2 objects remain explicit
storage failures. Organization-owned attachments remain outside this contract.

## Required Schema And Runtime Profile

Apply every tracked migration in order. These six migrations are unconditional
requirements for this source, even with all company flags disabled:

| Migration                                          | Required contract                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `0025_organization_groups.sql`                     | Groups, same-organization member links and collection grants                                     |
| `0026_organization_policies.sql`                   | One type-0 policy per organization; missing row means disabled                                   |
| `0027_session_mfa_assurance.sql`                   | Current TOTP generation, exact-family proof columns, and proof invalidation triggers             |
| `0028_organization_audit_scope_index.sql`          | Indexed immutable event-time organization scope for bounded audit queries                        |
| `0029_organization_membership_mutation_marker.sql` | Internal membership mutation nonce binding the write to its required audit                       |
| `0030_organization_policy_mutation_marker.sql`     | Internal policy mutation nonce and same-batch assertion against silently ignored audit insertion |

Shared vault queries, membership lifecycle writes, account deletion, authentication,
and sync policy projection use the schema independently of management route flags.
Migration 0027 backfills a generation for enabled verified enrollment; it does not
create proof for any existing device. Do not populate device proof columns by
copying enrollment state or another device's verification.

Read the target's migration ledger and verify the tables, columns, scope index,
and invalidation triggers before admitting this source. `/health/db` checks
required tables and reports a schema version, but it is not proof that every
required column, trigger, or access invariant exists. A healthy response cannot
substitute for migration readback and the behavioral checks below.

Tracked Wrangler root, staging, and production values are all `"false"`:

| Flag                                         | Effect                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `HONOWARDEN_ADMIN_ENABLED`                   | Serves Worker-controlled administration assets; disabled returns `404` |
| `HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED` | Admits membership management and invitation operations                 |
| `HONOWARDEN_ORGANIZATION_GROUPS_ENABLED`     | Admits group management and group capability projection                |
| `HONOWARDEN_ORGANIZATION_POLICIES_ENABLED`   | Admits type-0 policy management and policy capability projection       |
| `HONOWARDEN_ORGANIZATION_AUDIT_ENABLED`      | Admits custom audit queries and export                                 |

Disabled management routes return `501 unsupported_feature` before authentication
or database work. Existing group assignments and enabled policies still affect
shared access when the corresponding management flag is disabled. Authenticated
global policy reads and sync still project applicable persisted policies for
client remediation. Optional `HONOWARDEN_AUDIT_LOGS` controls general audit logging;
it does not switch off required transactional administration events.

The static runtime needs the built `dist/admin` directory, the `ADMIN_ASSETS`
binding, and `run_worker_first: true`. A true browser flag with a missing binding
returns a reported `503`. The assets route strips bearer, cookie, and query data
before using the binding, rejects incorrect MIME types, and never substitutes HTML
for missing JavaScript or WASM. Its same-origin CSP permits the bundled WASM and
private crypto Worker without an external script CDN.

Use the existing access/refresh signing runtime and TOTP encryption configuration.
Audit cursors use the existing resolved refresh signing secret with a distinct
purpose; there is no separately provisioned audit-cursor secret in this source.
Signing-secret rotation can invalidate outstanding 15-minute cursors, which are
safe to restart from a new query. Invitation write routes require the dedicated
`HONOWARDEN_ORGANIZATION_INVITE_SECRET` and the
`ORGANIZATION_MEMBERSHIP_MAILER` service binding. Keep runtime secrets in the
established ignored/operator-managed sources described in
[operator environment](operator-environment.md), never in this document or tracked
configuration. A transport `202` means accepted for delivery, not recipient receipt.

## Local Build And Loopback Verification

Use the repository's declared package manager and a verified compatible Node
runtime. Company D1 evidence uses Node 22.22.0. With dependencies already prepared,
run the complete source gates and browser build:

```sh
pnpm check
pnpm lint
pnpm test
pnpm admin:build
pnpm format
pnpm brand:scan
```

`pnpm check` covers the Worker server and the browser, crypto Worker, and browser
test TypeScript configurations. Vitest success alone does not typecheck them.
The production build must contain the private crypto Worker and Argon2 WASM path;
an unavailable Argon2 implementation must fail visibly without a KDF fallback.
Run actual D1 suites with one coordinated fixture lane when host loopback port
pressure requires serialization. Preserve an infrastructure failure and its later
rerun as separate evidence; do not weaken assertions or increase blanket timeouts.

For an isolated synthetic local database only:

```sh
pnpm db:migrate:local
pnpm dev
```

`pnpm dev` accepts no forwarded arguments. The wrapper fixes the repository
Wrangler configuration, local execution, `127.0.0.1`, no tunnel, and no resource
provisioning; it strips ambient Cloudflare/R2 credentials and disables telemetry.
Do not use a remote mode or attach a real account's vault for this check. Prepare
the required local runtime values in the ignored `.dev.vars`, and enable only the
synthetic company routes needed by the fixture. Keep tracked flag defaults false.
Invitation transport must be a reviewed local synthetic adapter before testing
the actual invitation flow.

For browser development, run a second terminal:

```sh
pnpm admin:dev
```

Open `http://127.0.0.1:5173/admin/`. Vite binds loopback with a strict port and proxies
`/api` and `/identity` to `http://127.0.0.1:8787`; it does not proxy an arbitrary
remote origin. Loopback is the local secure-context exception for the private
Worker. Also verify the built assets through the Worker at
`http://127.0.0.1:8787/admin/` after `pnpm admin:build`, with the local admin flag
enabled. This second check exercises the MIME allowlist, CSP, stripped asset
requests, and missing-asset behavior that the development server cannot prove.

## Roles And Collection Access

Owner (`0`) manages supported roles. Admin (`1`) manages User (`2`) recipients
only; a group containing an Owner/Admin cannot be modified or deleted by an Admin.
User has no membership or group administration authority. A supported confirmed
membership in an enabled organization and an active account is required for shared
data. Invited, accepted, revoked, unsupported-role, and cross-organization records
cannot provide a shared vault key or cipher access.

Direct and group collection grants are combined. Any applicable writable grant
allows supported cipher writes; any applicable visible-password grant projects
password visibility; any management grant supplies that separate dimension.
Collection administration also needs writable access. No role implies every
collection. A writable grant on an unrelated collection cannot authorize a cipher.
The management UI explains inherited access separately so changing a direct grant
does not promise removal of access supplied by a group.

`hidePasswords` is enforced by trusted client presentation, not by separate
encryption. A custom client with the organization key can inspect decrypted data.
Do not use it to promise that an assigned member can never learn a password.

Group updates carry the revision returned by the read in `If-Match`; a conflict
requires reading current state and reviewing the draft. Member role/grant updates
replace the complete direct assignment set. Read full assignments first and retain
unknown IDs rather than silently deleting grants. Network ambiguity calls for
readback before retry; successful membership mutations can return empty `200`.
An invitation delivery failure may return `503` with `persisted: true`: the rows
exist, so inspect them and intentionally reinvite rather than automatically
repeating the original batch. See the underlying
[membership contract](organization-membership.md).

## Required TOTP Activation And Remediation

Only policy type `0` is supported. Use:

| Method | Path                                        | Purpose                                       |
| ------ | ------------------------------------------- | --------------------------------------------- |
| GET    | `/api/organizations/{id}/policies`          | Sanitized policy list                         |
| GET    | `/api/organizations/{id}/policies/0`        | Current required-TOTP policy                  |
| GET    | `/api/organizations/{id}/policies/0/impact` | Enrollment counts for a confirmed Owner/Admin |
| PUT    | `/api/organizations/{id}/policies/0`        | Owner sets `{ "enabled": true }` or false     |

Other policy types and nonempty policy data are unsupported. Metadata is available
to active accepted/confirmed members for remediation, even without session MFA.
It never includes organization keys or per-member factor secrets. The impact counts
describe enrollment posture, not which sessions have passed TOTP. Every read still
checks the actor's active account and exact unrevoked family in the same SQL query.

Before activation, enroll and verify the acting Owner's TOTP, verify that a second
active confirmed Owner has a usable enrolled factor, and review the noncompliant
accepted/confirmed counts. A second enrolled Owner provides operational continuity;
activation's enforced minimum is the currently verified acting Owner. Warn users
that existing noncompliant sessions will lose effective shared access immediately.
The policy does not retroactively remove already downloaded ciphertext or keys.

Use `GET /identity/accounts/totp/assurance` for the current family's assurance state
and `POST /identity/accounts/totp/step-up` for bounded authenticated verification.
TOTP setup and verification remain available from personal settings. A valid
current TOTP login or step-up establishes proof for that exact family. An account
having TOTP enabled is insufficient. API-key and auth-request login families start
without proof; refresh can preserve only proof from its current family. Legacy
proofless sessions fail closed for protected organization data, while personal
settings and remediation retain their separate access rules.

An enabled policy checks verified enabled enrollment, current credential generation,
and device proof matching the authenticated `{ userId, sessionId, deviceIdentifier }`
on every shared read/write. Replacing, disabling, or deleting enrollment invalidates
all earlier proof. Same-device relogin replaces the family rather than restoring an
older bearer. In-flight preflight success does not authorize a later SQL operation
after offboarding, session revocation, or account disablement.

Acceptance under an enabled policy requires the recipient's enrollment and verified
family. Confirmation requires the manager's proof plus the recipient's enrollment;
the recipient can be offline. Existing members keep their lifecycle and grant rows
when noncompliant, but lose effective access until remediation. Revoked membership
does not become active again merely because TOTP is reenrolled.

An active confirmed Owner needs current proof to enable the policy or disable an
enabled policy. A password-only disable-policy recovery bypass is unavailable.
Demotion, revocation, removal, TOTP disablement, and account deletion must retain
an active confirmed Owner; under required TOTP, that remaining Owner must be
enrolled. The surviving Owner need not be online, since login/step-up restores
their family proof. D1 mutation predicates enforce this invariant during races.
Policy PUT is last-writer-wins with monotonic revisions; read back the final policy
when two authorized changes overlap.

An authorized Owner missing proof receives `403 organization_mfa_required`.
Unauthorized or stale-scope operations are obscured as `404`; stale authentication
can be rejected earlier as `401`. Database/schema failures are reported `503`, not
an empty successful policy. All these responses use `Cache-Control: no-store`.

## Partial Administration Audit

The custom endpoints are `GET /api/organizations/{id}/audit-events` and
`GET /api/organizations/{id}/audit-events/export`. Current confirmed active
Owner/Admin authority and exact-family policy evidence are rechecked for every
page and export. A signed cursor does not preserve authority after offboarding.

Coverage is twelve successful committed administration events: member invite,
reinvite, accept, confirm, update, revoke, remove; group create, update, delete,
member removal; and policy update. Mandatory events commit atomically with their
mutations even when general audit logging is disabled. Failures roll back the
business write, required event, and related revisions. Stored event-time organization
scope allows a valid historical row to remain readable after its target is deleted.
Unscoped legacy events are not attributed to an organization by a current lookup.
The policy marker and SQL assertion keep a silently ignored audit INSERT inside
this rollback boundary, including repeated request timestamps.

This record is partial: it does not prove all authentication, denials, reads,
organization creation, cipher/collection changes, or successful invitation receipt.
`UseEvents` stays false and the numeric event compatibility surface remains
unsupported. Display the returned coverage and event catalog in the UI.

The default window is seven days, with an inclusive `from` and exclusive `to` in
canonical UTC. The maximum window is 31 days; future timestamps are invalid.
Page limits are 1–100, default 50. The 15-minute signed cursor binds the organization,
actor, original filters, range, limit, and descending timestamp/ID position. Pages
are keyset reads, not a multi-page snapshot; a new query can observe new events.

CSV exports cap the entire selected result at 1,000 rows. More rows return `413`
before CSV headers or a partial download; narrow the time/event/actor filter and
retry intentionally. Formula-prefixed cells are neutralized. Raw context, request
IDs, device IDs, names, emails, IPs, ciphertext, and vault payloads are absent.
The window cap does not guarantee 31 days of retention. See
[organization audit](organization-audit.md) for the API's bounded query contract.

## Evidence, Failure Handling, And Recovery

Record each outcome separately:

1. Source delivery: exact commit, complete check/lint/test/build results, and preserved
   failures and reruns.
2. Runtime readiness: exact source/assets, complete migrations 0025–0030, configured
   local or separately admitted target, flag profile, and required secret/transport
   availability.
3. Actual-client acceptance: exact Browser/Desktop versions, synthetic invitations,
   email receipt evidence where relevant, enrollment and TOTP login, encrypted key
   confirmation, populated shared sync/decryption, refresh, lock/unlock, and logout.
4. Negative and recovery acceptance: proofless grants, invalid/reused TOTP, stale
   bearer/refresh family, revoked/disabled accounts, direct and group union, policy
   activation, last enrolled Owner races, audit rollback, export bounds, and local
   lock/late-response behavior.

Focused policy evidence includes actual D1 producer-to-audit reads and policy-on/off
stale-family metadata rejection. It cannot establish production operation or native
client decryption by itself. Until the coordinator records the actual company
acceptance result, leave those outcomes unresolved rather than promoting them
from source or health evidence.

If a required binding, schema element, crypto Worker, Argon2 module, or database
operation fails, retain the visible failure and safe request ID. Do not log a raw
exception containing tokens, invitations, factor seeds, wrapped keys, or vault data.
Read back ambiguous committed mutations before retry. Local logout clears local
state even if remote revocation fails; report that distinction.

Keep additive migrations and persisted policy/group/audit state during recovery.
Disabling management flags can contain those APIs but does not disable persisted
access controls. An older application that ignores current-family binding, required
policy, or group union is an unsafe source fallback. Use a reviewed forward recovery
build preserving the authorization predicates, or stop affected authenticated
access until one is available. Never repair access by copying session IDs, clearing
revocation, assigning factor proof, or deleting a required policy.

A second enrolled confirmed Owner can restore administrative continuity through
normal verified login. A sole Owner who loses the factor has no self-service
password-only override in this slice. Existing account deletion restoration and
[account lifecycle](account-lifecycle.md) tools are distinct from forgotten-password
or factor recovery. Credential forward recovery must validate a coherent restored
credential generation and move forward without accepting older sessions; it does
not download plaintext vault secrets or create a recovery envelope. Keep protected
evidence and follow the existing scoped recovery process for the specific account.
