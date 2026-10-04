# Company Recovery And Identity Decision

Decision date: 2026-10-04. The user selected email, master password, and TOTP first,
with SSO later and acceptance in the Browser extension and Desktop. The first phase
uses operator-provisioned, allowlisted accounts. Recommend two active,
confirmed Owners with independently usable enrolled factors before requiring MFA.
This is a source-backed operating boundary, not a claim of remote recovery or
IdP acceptance. Delivery and actual-client evidence remain in the
[company administration contract](company-administration.md).

## What Can Be Recovered Today

| Incident or need                                           | Current supported path and limit                                                                                                                                                                                                                                                    | Source or evidence                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost device, credentials still known                       | Fresh password/TOTP login on a new device; revoke the lost device. `revoke-all` revokes other devices and retains the caller; logout revokes the current family.                                                                                                                    | [API routes](../../src/app.ts), [session binding](device-sessions.md)                                                                          |
| Replace a working authenticator                            | Recent password authentication, current TOTP verification, then verification of the pending new factor. Replacement invalidates earlier family proof.                                                                                                                               | [TOTP session repository](../../src/repositories/mfa-session-repository.ts), [migration 0027](../../migrations/0027_session_mfa_assurance.sql) |
| Lost factor with a still-valid recent session              | The user's own TOTP-disable route can operate from an exact active family with recent password authentication; it cannot remove the last enrolled Owner under required policy. Reenroll and verify before regaining protected access. It does not provide a new login without TOTP. | [API routes](../../src/app.ts), [Owner guard](../../src/repositories/totp-repository.ts)                                                       |
| Lost factor without that session                           | No recovery-code, email-only factor reset, or manager factor-reset API exists. A second accessible Owner preserves organization administration but cannot reset the affected user's factor. A sole inaccessible Owner has no policy bypass.                                         | [required MFA decision](../adr/0016-company-administration.md), [policy repository](../../src/repositories/organization-policy-repository.ts)  |
| Forgotten master password, no usable unlocked key material | No forgotten-password reset, organization recovery envelope, or admin decrypt/takeover API exists. A replacement authentication hash alone would not unwrap the existing user key.                                                                                                  | [account-key contract](../../src/domain/account-keys.ts), [capability projection](../../src/app.ts)                                            |
| Deleted account still inside its recovery window           | Private `AccountLifecycleOperator` recovery for the exact deletion generation before the 30-day cutoff; retain encrypted data, issue a new security stamp, and keep prior sessions revoked. This does not replace lost credentials.                                                 | [lifecycle runbook](account-lifecycle.md), [recovery repository](../../src/repositories/account-lifecycle-repository.ts)                       |
| D1/R2 corruption or accidental data loss                   | Operator encrypted-state backup and fresh-target restore, with manifest/checksum, coherent credential generation, and complete attachment inventory checks. Local synthetic restore/CLI evidence exists; it does not establish recovery of today's company authorization state.     | [backup contract](backup-restore.md), [credential evidence](../../compat/credential-evidence.json)                                             |
| Emergency access or personal-account takeover              | Runtime routes remain `501 unsupported_feature`, including with the emergency runtime flag. The accepted future design and stored relationship foundation are not a working takeover path.                                                                                          | [ADR 0013](../adr/0013-emergency-access-product-line.md), [route guard](../../src/app.ts)                                                      |
| IdP login, SCIM, or passwordless decryption                | Not implemented in this phase. `UseSso`, `UseScim`, and `UseResetPassword` remain false; WebAuthn enrollment does not implement passkey login.                                                                                                                                      | [protocol config](../../src/protocol/config.ts), [organization projection](../../src/app.ts)                                                   |

The recent-password window is five minutes. A user whose password grant already
requires an unavailable TOTP factor cannot obtain that recent session by knowing
the password alone. The ordinary password-change and credential forward-recovery
flows require working credential/key material; they are not forgotten-password
recovery. The
[forward-recovery tool](../../scripts/honowarden-credential-forward-recovery.mjs)
is restricted to local synthetic restored targets and commits one forward password
generation, rejecting retries and earlier generations.

`POST /api/accounts/delete-recover` sends an account-deletion confirmation token;
`/delete-recover-token` consumes it and enters recoverable deletion. Despite their
names, these endpoints do not restore an account or recover a password. Actual
reactivation is the generation-bound private operator method. After irreversible
purge, there is no inverse lifecycle operation; backup restoration is a distinct
incident procedure.

## Replacement Accounts Preserve Company Continuity

Public registration is disabled. `POST /api/accounts/bootstrap` requires the
bootstrap flag, the dedicated bootstrap token, and an email in
`HONOWARDEN_ALLOWED_EMAILS`; it returns `409` for an existing normalized email.
The [bootstrap parser](../../src/domain/bootstrap.ts) accepts a client-derived
authentication hash and opaque wrapped account keys with the supported key state,
using its declared PBKDF2 settings. It does not generate a vault key, overwrite an
existing account, assign Owner, or recover the old account's personal vault.
Supply key material from the intended client's derivation flow; never substitute
an operator-chosen password/hash for a lost account's encrypted key wrappers.

When an existing Owner can still unlock the organization, company access for an
affected person can be reprovisioned to a distinct allowlisted identity:

1. Verify the replacement person's identity and preserve the incident's exact old
   user/membership IDs. Revoke the old membership through the existing Owner/Admin
   authority; do not treat mailbox control as a recovered vault key.
2. Provision the new account through the bounded bootstrap path. If the old email
   still exists, use a distinct allowed identity; bootstrap cannot overwrite it.
3. Invite, accept, and confirm the new membership. Under required policy, the new
   account enrolls/verifies TOTP, and an accessible manager wraps the organization
   key to its new public key. Restore only the intended direct/group assignments.
4. Confirm shared sync/decryption, old-membership denial, and fresh-family MFA on
   the exact client/source. Personal data from the old account remains inaccessible
   unless its original decryption material is independently available.

Organization authority does not authorize another user's `/api/devices` actions.
Membership revocation removes future company API access; device revocation is
self-service, and account lifecycle control uses its separate operator boundary.
Neither removes organization ciphertext or plaintext already cached by a client.
Reprovisioning is a new cryptographic recipient and a new membership, not a password
reset or automatic recovery of former grants. Keep the supported Owner continuity
invariant during the transition.

## Restore Must Preserve Current Authorization

An encrypted backup restores bytes and metadata from its checkpoint. It cannot
reconstruct a forgotten master password, and it does not automatically contain
revocations, offboarding, policy changes, or invitation consumption committed after
that checkpoint. Canonical D1/R2 equality proves checkpoint fidelity, not current
authorization. The historical local restore evidence intentionally accepts the
checkpoint's current credentials and rejects earlier generations; that is not
evidence that later revocations survived a restore.

Bind any company restore evaluation to the exact application source and the full
schema through [migration 0030](../../migrations/0030_organization_policy_mutation_marker.sql).
Retain groups, required policies, current TOTP generations, session binding/proof,
event-time audit scope, and membership/policy mutation markers. The 0029 and 0030
nonces bind those writes to their same-batch audit; they are not external rollback
counters.
Restoring an old nonce, old invitation verifier, or old device family can restore
historical authority unless a later authoritative state is reapplied.

Keep the fresh restore target isolated until the following readbacks exist:

- Exact backup and credential-generation manifest identity, full D1/R2 inventory,
  all required schema elements, and a discarded/recreated target after partial
  restore failure, as required by the existing backup contract.
- A reconciliation from evidence outside the restored snapshot of subsequent
  membership removals, role/direct/group changes, required policy changes, account
  disablement, consumed invitations, and device/refresh revocations.
- A source-preserving forward session/credential closeout that rejects previously
  issued bearer/refresh families, followed by fresh login and fresh current-factor
  evidence. Never copy MFA proof or clear revocation to make a smoke pass.
- Old/offboarded account and invitation replay denial plus intended member
  sync/decryption, not only `/health/db` or import equality.

The current generic backup and local forward-recovery tools do not automate this
company-wide post-checkpoint authorization reconciliation. Record its exact scope
and readback in the restore incident; an unverified snapshot remains an isolated
recovery candidate. A source fallback that ignores session binding or required
policy cannot provide safe continuity.

## Company Decisions For The Next Identity Phase

The first phase can exercise invitations, group/direct access, TOTP, offboarding,
and the bounded incident paths above without choosing an IdP. Capture these later
choices as concrete requirements, rather than treating every identity option as
supported:

| Decision                         | Required company input and resulting contract                                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported IdP                    | Named provider, tenant/issuer, OIDC or SAML, stable subject and email-change mapping, approved MFA claims, session lifetime/logout, and deprovisioning latency. Specify whether SCIM is needed and how it preserves a usable Owner.                                                                              |
| Vault unlock and loss recovery   | Decide whether users retain a master password or use a separately designed key-unlock/recovery envelope. Define its key custodian, recovery identity proof, audit, revocation, and client support. An SSO assertion authenticates a person; it does not decrypt the existing user or organization key by itself. |
| Residency                        | Required jurisdictions for D1, R2, encrypted backups, signing/TOTP-wrapping keys, logs, and invitation transport; identify the actual platform/storage controls and readback that satisfy them. A Worker location or resource name alone does not establish residency.                                           |
| Retention and restore objectives | Explicit audit/log/invitation/backup retention, deletion and legal-hold handling, backup schedule, RPO/RTO, restore ownership, and an independent record of post-backup authorization changes. The 31-day audit query cap is not retention; recoverable deletion currently has a 30-day window.                  |
| Loss of every Owner credential   | Decide the required outcome: reprovision with an accessible enrolled Owner, accepted loss of undecryptable data, or a new reviewed cryptographic recovery mechanism. The current code supplies no sole-Owner factor/password bypass.                                                                             |

These decisions extend the product and its key/identity model. They do not activate
SSO, SCIM, reset-password capability, or takeover by changing a flag. Keep the
present phase's operating account and recovery claims explicit in company
acceptance evidence.
