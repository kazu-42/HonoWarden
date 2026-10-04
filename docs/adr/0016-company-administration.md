# ADR 0016: Company Administration And Required Session MFA

## Status

Accepted implementation contract, 2026-10-04. Source delivery, runtime rollout,
and actual-client acceptance are separate outcomes. This ADR does not claim that
the company feature has been committed, migrated remotely, activated, or accepted
in the current Browser or Desktop client. Those outcomes require the coordinator's
exact-source evidence in the [current state](../current-state.md) and the
[release evidence index](../release/index.md). HonoWarden remains pre-alpha.

This decision extends the organization foundation in ADR 0005, policy scope in
ADR 0006, the team-vault product line in ADR 0010, and the metadata-only audit
candidate in ADR 0015. It admits one bounded company administration slice rather
than complete parity with another product's administration or Web Vault.

## Context

The existing server can synchronize opaque encrypted vault data and manage
invitations through an authenticated API. Company use also needs a browser
interface, group-based collection assignment, an enforceable MFA requirement,
and a bounded record of committed administrative changes. Enrollment alone does
not demonstrate MFA: an API-key grant or an old password-only session can belong
to an account that has TOTP enabled. Likewise, a bearer authenticated before
offboarding can become stale before its database query executes.

The user selected email, master password, and TOTP for the first phase, with SSO
later and acceptance in the current Browser extension and Desktop versions. The
company browser is an original HonoWarden interface. It uses existing supported
protocol operations and new explicit company APIs; it does not import a vendor's
Web Vault assets, protected UI expression, or undocumented authenticated behavior.

## Decision

### Authenticated Browser And Private Crypto Worker

Build the administration entry point in `admin/`, with the API facade in
`admin/browser/admin-client.ts` and a dedicated module Worker for cryptography.
The Worker serves a bounded command set for derivation, unlocking, encrypted
collection names, organization-key wrapping, and organization creation. It has
no generic execution or plaintext-key export operation.

The browser obtains account KDF settings before authentication and applies the
recorded settings. PBKDF2 uses WebCrypto. Argon2id uses the bundled, pinned
`hash-wasm@4.12.0`; its memory conversion and SHA-256 email-salt preprocessing
are covered by independent vectors. An unavailable Worker, unavailable WASM,
unsupported KDF setting, or failed MAC/key-pair validation produces an explicit
failure. It cannot select PBKDF2 as a fallback or ask the server to derive vault
keys. Authenticated encrypted strings validate their MAC before decryption.
Organization keys are wrapped for each recipient's public key in the browser.

Vault keys remain in the private Worker. Access and refresh tokens remain in a
private main-thread closure. Neither is persisted to local storage, session
storage, IndexedDB, URLs, or cookies. API requests are same-origin, omit cookies,
reject redirects, disable caching, and bound response size and request lifetime.
Passwords necessarily enter the UI and are passed to the Worker; references are
cleared and byte buffers are overwritten where practical. JavaScript strings,
browser extensions, and a compromised browser remain outside any perfect-erasure
claim. TOTP setup material is transient authenticator enrollment material and
does not provide a vault-key export path.

Local lock terminates the Worker and aborts pending work. Epoch checks prevent
late replies from restoring unlocked state. A completed session may retain its
tokens in memory for a subsequent password unlock; lock is not server revocation.
Idle and hidden-tab locking reduce exposure. Logout clears local state before
attempting bounded server revocation, and failed revocation must remain visible.
Invitation capabilities are consumed from the fragment, removed from the URL,
and retained only in memory while the acceptance flow is active.

Static administration assets are served through the Worker-controlled `/admin/`
route with a narrow allowlist, `Cache-Control: no-store`, a same-origin CSP, and
no framing. The asset binding receives a newly constructed request without
bearer, cookie, or query capabilities. Missing JavaScript/WASM must not receive
an HTML SPA fallback. `ADMIN_ASSETS` and `run_worker_first: true` are part of the
serving contract. The browser never grants authority by displaying a control;
every API query or mutation checks authority again.

### Roles, Membership, And Group Union

Support Owner (`0`), Admin (`1`), and User (`2`). A confirmed active Owner can
manage supported memberships and groups. An Admin can manage User recipients;
an Admin cannot promote or manage Owner/Admin memberships, or mutate a group
containing a privileged membership. Unsupported roles and broad `accessAll`
permission are not admitted. A role does not automatically grant every
collection.

Direct and group collection assignments form a union within one organization.
For each effective collection, any `readOnly: false` grant permits supported
writes, any `hidePasswords: false` grant permits the trusted-client password
view, and any `manage: true` grant supplies the independent management dimension.
Collection administration additionally requires a writable grant. The shared
cipher query requires a grant on a collection actually containing that cipher.
Unrelated collections, cross-organization memberships, historical creators, and
unconfirmed memberships cannot supply access.

Groups may prepare assignments for invited or accepted members, but shared data
requires a confirmed supported membership, an enabled organization, and an active
account. Group writes use a revision guard and recheck manager authorization in
the same D1 mutation. Full membership replacement reads and preserves the complete
direct assignment set. Unknown IDs are not silently dropped by a partial UI.

`hidePasswords` is a trusted-client UI permission. An assigned member receives
encrypted cipher data and an organization key, so this flag is not cryptographic
separation of a password from that member. Requirements that a member must never
learn a secret need a different key/vault boundary.

### Required TOTP Is Enrollment Plus Current-Family Evidence

Implement only policy type `0`, required TOTP. A missing policy row means disabled;
`organizations.use_totp` and the `UseTotp` projection describe a capability, not
an enforced organization requirement. Policy metadata and impact counts are
available to authorized active sessions for remediation even when the session
has not completed MFA. Every metadata read still rechecks the active account and
the exact unrevoked user/device/session family inside SQL.

Protected shared reads and writes require both:

1. Current verified, enabled TOTP enrollment with a non-null credential generation.
2. Successful TOTP evidence on the requesting device's exact active `session_id`,
   with the same current credential generation and a verification timestamp.

The authorization input is `{ userId, sessionId, deviceIdentifier }`. Neither a
token claim nor a user-global enrollment boolean substitutes for persisted
family evidence. HTTP callers always pass their authenticated actor. The central
SQL predicate rechecks active accounts, enabled organizations, confirmed supported
memberships, exact session state, and current factor generation where required.
Legacy repository calls without actor context cannot satisfy a required policy.

A successful TOTP password login or bounded authenticated
`POST /identity/accounts/totp/step-up` can establish proof for that exact family.
Refresh inherits evidence only through the existing family; it cannot copy proof
from another device or create proof from enrollment. Personal API-key and approved
auth-request grants start without TOTP evidence. A legacy family without evidence
fails closed for protected organization access. Personal settings, enrollment,
and account remediation remain available through their own authenticated routes.

Replacing, disabling, or deleting TOTP clears earlier family evidence. Reenrolling
creates a new generation and requires fresh verification; it cannot revive old
proof or revoked membership. Revocation and same-device relogin cannot make an
older family current again. Assurance reflects successful verification in the
current family, not a separately configured periodic MFA expiry.

Acceptance into an organization with an enabled policy requires the recipient's
current enrollment and current-family verification. Confirmation requires the
manager's valid protected access and the recipient's current enrollment; it does
not require the recipient to be online. Enabling a policy immediately removes
effective shared access from existing noncompliant members. It preserves their
lifecycle rows and assignments so they can remediate without a second invitation.
It does not remotely erase ciphertext or keys already cached by a client.

Only an active confirmed Owner changes a policy. Activation requires the Owner's
current TOTP proof. Disabling an enabled policy requires that proof too. Disabling
an already-disabled policy requires an active family but does not force enrollment.
Policy updates are last-writer-wins, with strictly increasing revisions; they do
not offer an optimistic policy revision guard.

### Owner Continuity, Races, And Atomic Audit

Demotion, revocation, removal, TOTP disablement, and account deletion must leave
an active confirmed Owner. Under required TOTP, the surviving Owner must also be
currently enrolled. That Owner need not have an online assured session: a fresh
TOTP login or step-up supplies access. The invariant is checked inside the D1
mutation so two concurrent removals cannot each rely on the other Owner.
Activation's verified acting Owner establishes the initial enrolled Owner.

Authorization is part of the SQL query or conditional write, rather than a
preflight-only decision. A prior successful read does not authorize a later
write after offboarding, role change, factor change, or session replacement.
Writes and mandatory administration audit records share one D1 batch. Audit
failure rolls back the mutation and associated revisions. Membership and policy
mutations use a distinct internal nonce, so an identical timestamp, failed replay,
or cascade count cannot attach an audit row to an unrelated write. A batch-local
SQL assertion rejects a changed policy whose mandatory audit INSERT was silently
ignored; a check after commit cannot supply that guarantee.

Record immutable event-time `organizationId` scope with each required event;
do not infer scope from the current target or current membership. The policy
producer includes that scope in its bound JSON inside the transaction. Organization
and affected account revisions advance monotonically, including hidden members
whose next poll must learn that effective access changed.

### Bounded, Partial Administration Audit

Expose the custom `/api/organizations/:id/audit-events` and `/export` APIs for
confirmed active Owner/Admin sessions, with current policy assurance checked
again on every page and export. Supported successful events are seven membership
operations, four group operations, and `organization.policy.update`: twelve names
in total. This is a partial record of committed administration, not a complete
authentication, denial, read, cipher, collection, invitation-delivery, or activity
log. Numeric vendor event APIs remain unsupported and `UseEvents` remains false.

Queries default to seven days and cannot exceed 31 days. Pages contain at most
100 rows. The signed 15-minute cursor binds actor, organization, filters, bounds,
limit, and keyset position; it is not an authorization capability. CSV exports
probe beyond a 1,000-row ceiling and return `413` before download when too large.
CSV formula prefixes are neutralized. Responses omit raw event context, request
IDs, devices, email addresses, IP addresses, secrets, and vault payloads. Existing
retention can remove old rows; a query window is not a retention guarantee.
The optional general audit-logging flag cannot disable required transactional
administration events.

### Schema, Flags, And Recovery

Apply all additive migrations 0025 through 0030 before running this source, even
when management flags are false. Shared access, authentication, lifecycle, sync,
and policy projection SQL depend on the new schema independently of route flags.
Migration 0027 gives existing enrollment a generation but manufactures no session
MFA proof. Migration 0030 adds the internal policy mutation marker needed by the
mandatory-audit assertion. Rollout must therefore account for fresh TOTP
verification and the complete additive schema.

Keep browser, membership, groups, policy management, and audit flags default-off
in tracked root, staging, and production configuration. A route flag controls
management availability or advertising; disabling it does not erase groups,
remove mandatory audit records, or suspend an already-enabled policy. Runtime
activation requires the complete schema, assets, secrets, transport, and acceptance
evidence described in the [operations contract](../operations/company-administration.md).

Use additive schema retention and a reviewed forward fix for recovery. Reverting
to a source build that ignores policy, group grants, or immutable session binding
would reopen access and is unsafe. If no safe build is available, stop affected
access rather than manufacture session proof or delete policy rows. An enrolled
second Owner can recover administrative continuity; a sole Owner who loses the
factor has no password-only policy bypass in this slice. Existing account deletion
recovery and credential forward-recovery tools do not constitute a forgotten
password or organization factor-recovery product. No UI downloads plaintext
vault secrets or a recovery key envelope.

## Deferred Work And Consequences

Full personal Web Vault editing, IdP/SSO, SCIM provisioning, custom roles, a general
policy engine, recovery-key envelopes, organization takeover, and passkey login
are deferred. Existing WebAuthn enrollment work is not passkey authentication.
The confirmed initial preference is email, master password, and TOTP.

The private Worker and nonpersistent tokens reduce exposure, while increasing
the need for deterministic lock, timeout, cancellation, and failed-logout behavior.
Group union preserves existing collection semantics, while making the UI's direct
versus inherited grant explanation necessary. Required session MFA closes the
enrollment-only bypass, while interrupting legacy shared access until verification.
Owner continuity avoids routine lockout, while intentionally leaving sole-factor
loss for a separately designed recovery mechanism.

Unit/HTTP contracts, real D1 race and rollback tests, production asset build, local
browser operation, and exact-version native client decryption each provide different
evidence. A successful source test or commit cannot stand in for migrated runtime
enforcement, email receipt, restore acceptance, or current-client company acceptance.
