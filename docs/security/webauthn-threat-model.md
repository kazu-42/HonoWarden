# WebAuthn Threat Model

Status: design review for HON-208. No WebAuthn route, credential, challenge, or
live authenticator exists in HonoWarden at this stage.

Last reviewed: 2026-07-19.

## Scope

This model covers the planned HonoWarden WebAuthn trust policy, discoverable
assertion login, credential enrollment/inventory, optional PRF-backed Vault
unlock, lifecycle changes, sessions, audit, and rollback. It covers browser and
server boundaries conceptually but does not claim support for any browser,
extension, desktop, native, CLI, custom domain, or authenticator.

Out of scope for HON-208 are verifier implementation, D1 migration, routes,
deployment, production activation, real credentials, hardware tests, account
recovery product design beyond the invariants below, and independent penetration
testing.

## Assets

- Account authentication authority and the account `security_stamp`.
- WebAuthn credential identifiers, COSE public keys, user handles, sign counters,
  transports, AAGUIDs, backup flags, and lifecycle state.
- Purpose-bound challenge tokens, challenge bytes/checks, expiry, RP ID, exact
  origin policy, owner binding, and consumed state.
- Device and refresh sessions established from a verified credential.
- Encrypted user/public/private-key material used for PRF-backed Vault unlock.
- Client-only PRF outputs, derived symmetric keys, and decrypted Vault key.
- Operator-owned RP/origin configuration and activation intent.
- Audit, logs, fixtures, issue comments, and compatibility evidence that could
  accidentally retain authentication material.
- User availability: at least one recently proven account and Vault recovery
  path must survive lifecycle operations.

The public PRF salt SHA-256 input `passwordless-login`, public RP hostname, and
public origin URLs are not secrets. They remain sensitive operational context
and must not be echoed through arbitrary errors or mixed with request-derived
values.

## Trust Boundaries

1. **Operator configuration to Worker:** trusted only after strict parsing.
   Missing or invalid enabled configuration is unusable. Dashboard, deployment,
   and local files remain separate operational boundaries.
2. **HTTP request and proxy headers to Worker:** untrusted. `Host`, `Origin`,
   `Forwarded`, `X-Forwarded-*`, and Cloudflare visitor headers can be compared
   with policy but cannot define RP ID or accepted origins.
3. **Browser/client to anonymous options and grant:** untrusted and
   enumeration-sensitive. User handle, credential id, token, and
   `deviceResponse` are attacker-controlled until maintained-library verification
   and owner lookup succeed.
4. **Authenticated client to credential management:** bearer identity is
   necessary but not sufficient for enrollment, key-set update, or deletion.
   Exact owner scope and recent proof are separate boundaries.
5. **Worker to maintained verifier:** the verifier owns CBOR, COSE, client data,
   authenticator data, signature, RP/origin, UV, attestation, and counter
   validation. Application code owns policy selection and atomic persistence.
6. **Worker to D1:** D1 is authoritative for challenge single use, credential
   ownership/state, counters, and session provenance. Read-then-write application
   sequences are not sufficient for replay or concurrency safety.
7. **Authenticator/browser PRF to client Vault:** PRF output and derived key
   remain client-only. The server stores only encrypted key material and must not
   impersonate this boundary.
8. **Runtime to logs/audit/evidence:** output is lower trust and longer lived.
   Only bounded reason codes and synthetic aggregate evidence may cross it.

## Attacker Capabilities

- Send arbitrary anonymous and authenticated HTTP requests, race requests, and
  replay previously observed client payloads.
- Control request URL, headers, malformed form/JSON fields, origin-like strings,
  user handles, credential ids, and authenticator response bytes.
- Own domains whose names contain or suffix-match a legitimate RP string without
  sharing its DNS-label parent, such as `evil-example.com`.
- Possess a stolen bearer or refresh token, or a credential from a different
  account/RP, without possessing the victim's master password or PRF key.
- Trigger quota pressure, expired-state accumulation, malformed parser paths,
  and concurrent challenge/counter updates.
- Read application logs or issue evidence after a separate observability breach.
- Use legitimate synced passkeys whose counter remains zero, creating ambiguity
  that must not be mistaken automatically for cloning.

The attacker is not assumed to break standard cryptography, the authenticator's
hardware boundary, TLS, or a correctly configured maintained verifier. Operator
account compromise and malicious dependency publication remain residual supply-
chain/operations threats requiring separate controls.

## Abuse Paths And Mitigations

| Abuse path                                                     | Failure impact                                      | Required mitigation and evidence                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| RP ID confusion from forwarded host                            | Attacker-selected RP policy or unusable credentials | RP ID comes only from validated operator binding; tests prove no request-derived fallback         |
| Origin suffix confusion                                        | `evil-example.com` accepted for `example.com`       | Exact hostname or `.` label-boundary child check; cross-RP tests                                  |
| Wildcard, credentialed, path/query/fragment, custom-scheme URL | Trust set broadened or parser ambiguity             | Structured URL parsing plus exact-origin constraints; fail-closed table tests                     |
| WHATWG repair of malformed raw origin                          | Malformed input becomes a trusted canonical host    | Compare raw serialization with a narrow case/root-slash/default-port allowlist before acceptance  |
| HTTP outside local development                                 | Network-origin downgrade                            | HTTPS required; separate opt-in permits only exact `localhost`, not IP or subdomain               |
| Enabled but incomplete configuration                           | Partial outage or reduced accidental allowlist      | Entire policy status is `misconfigured`; no partial origins returned                              |
| Anonymous account enumeration                                  | User or credential discovery                        | Discoverable options independent of account input, generic grant errors, persistent quotas        |
| Challenge replay or concurrent consume                         | Multiple sessions or duplicate state transition     | Hashed purpose-bound challenge, fixed expiry, D1 conditional single-winner transition             |
| Challenge purpose substitution                                 | Registration token used for login/key update        | Persist and compare exact ceremony purpose, owner where known, RP and policy version              |
| Foreign credential or user-handle substitution                 | Cross-account login or key disclosure               | Resolve owner only from verifier-checked handle plus exact owner credential; transactionally bind |
| Failed verification writes state                               | Counter/session corruption or replay lockout        | No counter, challenge, device, refresh, or session update until full verification succeeds        |
| Positive counter regression                                    | Possible cloned authenticator accepted              | Fail the assertion, record bounded risk code, preserve stored counter, apply lifecycle response   |
| Synced credential counter zero                                 | Legitimate passkey lockout                          | Preserve zero when backup eligible; evaluate verified backup flags; never manufacture a counter   |
| PRF key-set substitution                                       | Victim receives another credential's encrypted keys | Select exactly one key set by asserted owner credential; complete triple required                 |
| Server receives PRF output                                     | Vault-unlock key compromise                         | Client strips extension output; server rejects/ignores it and never logs authenticator extensions |
| Last recovery path deletion                                    | Permanent account or Vault lockout                  | Recent independent proof and explicit last-method rule; TOTP alone does not count                 |
| Deleted credential sessions remain valid                       | Continued access after credential removal           | Credential session provenance; targeted revoke or security-stamp plus refresh-token revocation    |
| Sensitive audit/log capture                                    | Long-lived credential and identity leakage          | Stable reason codes only; forbid raw configuration values and all listed authenticator material   |
| Option/grant flood                                             | D1, CPU, or verifier exhaustion                     | Bounded payloads, network/device/account quotas, early syntax rejection, bounded cleanup          |
| Stale challenge cleanup failure                                | Storage growth or operational pressure              | Idempotent bounded cleanup, observable failure, fixed expiry enforced independently of deletion   |

## Authentication And Vault-Key Separation

A verified signature proves credential control under one RP/origin policy. It
does not prove that the client has recovered the Vault key. PRF-backed unlock
requires all of the following:

1. the exact asserted credential reports PRF support;
2. that credential has a complete encrypted key triple;
3. the client obtains PRF output from the authenticator with the fixed
   `passwordless-login` domain-separation salt;
4. the client locally unwraps the private/user key and reaches its normal Vault
   success condition.

The server can establish an authenticated session without condition 3 or 4, but
must not label it passwordless Vault unlock or return another credential's key
set. Compatibility evidence must report authentication and Vault unlock as
separate outcomes.

## Recovery And Lifecycle Invariants

- Enrollment never silently replaces an existing credential or key set.
- The sixth credential is rejected before persistence.
- Rename changes bounded metadata only.
- PRF enablement requires an assertion scoped to the same credential and cannot
  change authentication authority.
- Delete requires exact owner scope and recent supported proof.
- The final usable WebAuthn or PRF Vault path cannot be removed unless a distinct
  recovery path was just proven. Recent password proof is currently the only
  established independent method; TOTP is a second factor, not recovery.
- Deletion or security disable revokes credential-derived sessions. Uncertain
  targeting fails toward broader security-stamp/refresh revocation.
- Rollback disables entry points but never rewinds consumed challenges,
  counters, credential deletion, security stamps, or refresh revocation.

## Error And Redaction Contract

Public policy failures expose only stable codes such as
`invalid_enabled_flag`, `invalid_rp_id`, `invalid_origin`,
`insecure_origin`, and `origin_rp_mismatch`. They expose no raw configuration
values. Anonymous ceremony failures collapse account-sensitive causes into a
generic contract while internal metrics can count bounded reason categories.

The following never enter logs, audit context, fixtures, screenshots, workflow
artifacts, Linear/GitHub comments, or staged evidence:

- raw configuration values from a failed parser;
- raw challenge or opaque route token;
- credential id bytes, COSE public key, user handle, AAGUID;
- attestation object, client data JSON, authenticator data, signature;
- PRF extension output, derived keys, decrypted key material;
- encrypted private key or complete `deviceResponse` payload.

Request IDs, synthetic counts, timing class, ceremony purpose, success/failure,
and stable redacted reason codes are sufficient for operations. Any exception
requires a separate approved incident evidence process and must still avoid
reusable authentication material.

## Operational Failure And Rollback

The tracked environments are disabled. After later activation, invalid policy
must fail loudly before challenge issuance. Operators first set enablement false
to contain policy incidents, read back route/capability absence, and preserve D1
state for review. They do not delete credential/challenge tables, clear counters,
or restore consumed challenges as rollback.

Activation and rollback evidence must identify environment, source revision,
policy status, route result, and redacted reason codes without printing RP/origin
inputs. Staging success does not promote production. One browser host does not
promote another host or the CLI.

## Residual Risks And Review Triggers

- DNS ownership and public-suffix validity are operator/verifier responsibilities;
  the pure parser validates canonical labels but is not a public suffix list.
- Maintained verifier defects and supply-chain compromise remain possible;
  HON-209 must pin and audit the dependency and prove a Cloudflare Workers
  bundle/dry-run.
- Synced-passkey counters cannot always detect cloned credentials; backup state
  improves interpretation but does not eliminate risk.
- TOTP interaction with the pinned client's WebAuthn flow is unresolved and must
  be decided in HON-211 before session issuance.
- Host-specific extension/desktop/native origin mechanics remain unsupported
  until explicit policy and real-authenticator evidence in HON-214.

Review this model whenever RP/origin parsing, proxy handling, verifier version,
challenge schema, token auth method, TOTP policy, recovery methods, credential
lifecycle, session revocation, logs, or compatibility claims change.
