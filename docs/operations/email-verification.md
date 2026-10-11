# Email Verification Protocol Operator Contract

Status: experimental RP implementation contract, 2026-10-04. Tracked defaults
remain disabled. Source delivery and synthetic verification do not establish
runtime activation, first-party Origin Trial registration, or actual
browser/provider interoperability. Record each outcome separately in the
[current state](../current-state.md). HonoWarden remains pre-alpha.

The architecture and trust decision are in
[ADR 0017](../adr/0017-email-verification-protocol.md). Implementation entry points
are the [domain profile](../../src/domain/email-verification.ts),
[service and issuer resolver](../../src/email-verification.ts),
[HTTP routes](../../src/email-verification-routes.ts),
[transactional repository](../../src/repositories/email-verification-repository.ts),
[browser attempt](../../admin/browser/email-verification.ts), and
[administration document delivery](../../src/admin-routes.ts).

## Supported Outcome And Protocol Pin

EVP marks the already-authenticated account's unchanged current email as verified.
It requires that account's exact active user/device/session family and security
stamp at commit. It cannot create an account, change its email, log in, issue or
refresh tokens, complete MFA, accept or confirm membership, or decrypt/wrap keys.
Email, master password, and TOTP remain the first company authentication phase;
SSO is a later decision under the
[company recovery and IdP contract](company-recovery-and-idp.md).

The profile pins the individual IETF
[draft-hardt-email-verification-02](https://datatracker.ietf.org/doc/html/draft-hardt-email-verification-02),
not an RFC or a promise of all-browser support. The
[WICG report](https://wicg.github.io/email-verification/) and Chrome
[July](https://developer.chrome.com/blog/email-verification-protocol-origin-trial)
and [August](https://developer.chrome.com/blog/email-verification-august-2026)
guidance have representation differences. The pinned backend accepts `Ed25519`
and `ES256`, exact canonical email/issuer/audience, and no disclosures. It rejects
legacy `EdDSA`, missing holder-key algorithm, alias or case changes in the signed
email, and unrecognized proof profiles. Do not add a fallback to make an observed
provider token pass.

## Required Schema And Disabled Runtime Defaults

Apply all tracked migrations in order, including
[0031_email_verification.sql](../../migrations/0031_email_verification.sql), for
this source. A disabled feature flag does not replace the schema contract.
Migration 0031 adds the challenge table and expiry index; it does not backfill
verified emails or manufacture challenges for existing sessions.

The table binds each challenge to `user_id`, `session_id`, `device_identifier`,
`email_normalized`, `security_stamp`, and `audience`. `nonce_digest` contains the
43-character digest of a random 32-byte nonce. `created_at` and `expires_at`
bound its lifetime. `consumed_at` and the 36-character UUID
`verification_mutation_id` have a paired-nullability constraint, and
`UNIQUE(user_id, session_id)` replaces the prior attempt in that family.
The account foreign key cascades deletion. Challenge creation performs bounded
cleanup of at most 100 rows whose expiry is more than 24 hours old; this is not
an account-recovery or authorization-retention mechanism.

Wrangler root, staging, and production all contain:

| Binding                                            | Tracked value | Ready-state requirement                                                             |
| -------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `HONOWARDEN_EMAIL_VERIFICATION_ENABLED`            | `"false"`     | Only literal `"true"` enables the configured RP                                     |
| `HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN`          | `""`          | Exact canonical HTTPS origin of the RP form, without a path or trailing slash       |
| `HONOWARDEN_EMAIL_VERIFICATION_ISSUERS`            | `"[]"`        | Strict JSON registry with 1–16 distinct reviewed email-domain entries               |
| `HONOWARDEN_EMAIL_VERIFICATION_ORIGIN_TRIAL_TOKEN` | `""`          | Optional first-party trial token for eligible HTML documents; empty means no header |

Each registry entry has exactly `emailDomain`, `issuer`, and `jwksUri`. The issuer
is an exact public HTTPS origin without a port, path, or trailing slash; the JWKS
is an exact reviewed public HTTPS resource, including a separately hosted resource
only when explicitly registered. Do not add guessed URLs or extra algorithm
fields to this three-field configuration. The metadata's advertised algorithms
are independently checked against the EVT algorithm, with an absent metadata
field defaulting to `Ed25519`.

Unset or literal `"false"` disables the routes before authentication, quota,
database, or issuer work. Other flag strings, or `"true"` with incomplete or
invalid origin/registry configuration, produce a reported misconfiguration
failure. An enabled registry still supports only the exact registered account
domains. Runtime defaults and feature activation are separate from schema delivery.

The optional trial token is passed to administration routes only with a ready EVP
policy and a nonempty value. The admin surface must also be enabled. Successful
`200` HTML GET/HEAD responses for `/admin/`, `/admin/index.html`, and supported
`/admin/accept/...` documents receive `Origin-Trial` only when the actual request
URL's origin exactly equals the configured RP origin. Forwarded headers do not
select that origin. JavaScript, CSS, WASM, APIs, redirects, errors, disabled
surfaces, and an upstream asset binding's headers cannot supply the token.

One canonical standard-Base64 value of at most 8192 characters is accepted; lists,
whitespace, and CR/LF are invalid. Invalid supplied token/origin configuration
returns a sanitized document `503` and reports
`email_verification_trial_configuration`. This checks safe header syntax only.
The browser checks authenticity, the correct trial and origin, and expiry.

## Operator Preflight

Before an activation claim, establish these concrete facts for the intended RP
origin and a synthetic account:

1. Read back the exact source/build/configuration and the complete target migration
   ledger through 0031. Check the challenge columns, paired marker constraint,
   unique family key, and expiry index; a database health response alone is not
   proof of those invariants.
2. Establish the domain's current public `_email-verification.<domain>` TXT
   delegation and a documented issuer. One TXT record must yield `iss=host`, which
   derives exactly the registered `https://host`. Valid TXT chunks are joined;
   multiple records, CNAME discovery, or mismatched owners fail. MX records and
   mail-provider names cannot establish this delegation.
3. Review that exact issuer's `/.well-known/email-verification` metadata and
   registered JWKS. Metadata must repeat the exact issuer and JWKS URL and include
   a valid issuance endpoint. Confirm actual draft representation, holder-key
   algorithm, advertised issuer algorithm, and key rotation behavior against
   the strict profile. HonoWarden does not fetch the issuance endpoint or hold
   provider cookies.
4. Establish current first-party browser Origin Trial registration for the exact
   HTTPS form origin. Set the optional trial-token binding to use the built-in
   HTML response-header delivery, and read back `Origin-Trial` on the actual
   successful RP document. Follow the
   [browser registration guide](https://developer.chrome.com/docs/web-platform/origin-trials)
   and its [troubleshooting guidance](https://developer.chrome.com/docs/web-platform/origin-trial-troubleshooting),
   then verify present eligibility, origin matching, and expiry in the browser.
   The source does not register an origin or authenticate a trial token.
   A trial token is public configuration, not an account credential.
   Another origin's token, a third-party registration, or a browser flag cannot
   substitute for live registration evidence.
5. Run an ordinary-form flow with an approved synthetic account, the intended
   browser version, and a signed-in issuer account in the same browser profile.
   Verify persisted account state independently and unchanged authentication,
   TOTP assurance, membership, and key authority. Pin browser/provider, source,
   build, registry, RP origin, and trial fingerprints to the evidence.

Actual provider support and current trial availability must be established at
activation. A browser's EVP trial does not establish a Microsoft 365, Exchange,
Outlook, Entra, or other service's attestation issuer. Do not guess a Microsoft
issuer, reinterpret OIDC `email_verified`, or substitute a mail OTP for the
EVT/KB presentation. Keep the registry empty and EVP disabled until the concrete
delegation, reviewed issuer, and browser compatibility are established.

Private company-domain/provider observations belong only in the ignored operator
readiness packet, such as `email-verification-provider-readiness.local`. Do not
publish its content, customer identifiers, tenant observations, or derived issuer
guesses into documentation or a public registry.

## API, Consumption, And Outbound Limits

Both routes require authenticated JSON POST requests with exact configured
`Origin`, no query parameters, and no caller-supplied email or audience:

| Path                                              | Request                | Success                                                                         |
| ------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `/identity/accounts/email-verification/challenge` | `{}`                   | Challenge ID, nonce, canonical account email, audience, expiry, pinned protocol |
| `/identity/accounts/email-verification/verify`    | `{challengeId, token}` | `{"object":"emailVerification","verified":true,"method":"evp"}`                 |

The nonce expires after five minutes. Preparing another challenge for the same
family invalidates the previous ID and nonce. The account's exact live family,
canonical email, and stamp are rechecked when consuming the challenge, after
network and signature work. Single consumption, account update, and required
`account.email.verify` success audit share a D1 batch. A failed or ignored account
update or audit INSERT rolls the entire batch back. The random mutation marker
prevents a same-time failed attempt from being treated as a committed operation.

Verification preserves the first `email_verified_at` when already set and advances
the account revision. Audit context records only method and protocol. No raw
proof or nonce is stored or logged. The account event is not one of the custom
organization administration feed's event types.

Limits are implementation policy, not guarantees from the Internet-Draft:

| Resource                                             | Bound                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| JSON request / submitted presentation                | 16 KiB / 15 KiB                                                                            |
| Challenge / verification quota                       | 5 / 10 per account per 60 seconds; `429` includes `Retry-After: 60`                        |
| Challenge lifetime / proof maximum age / future skew | 300 / 300 / 30 seconds                                                                     |
| Uncached trust resolution                            | At most 3 sequential GETs under one shared 5-second deadline, including response streaming |
| External document / JWKS                             | 64 KiB each / 1–32 keys                                                                    |
| Trust cache                                          | At most 16 tuples, no more than the lesser of DNS TTL and 60 seconds; no stale fallback    |

The fixed resolver is `https://cloudflare-dns.com/dns-query`; subsequent requests
use only registered metadata and JWKS destinations. Redirects, wrong MIME types,
oversized responses, malformed JSON, and invalid delegation fail closed. No
arbitrary token URL, caller-selected resolver, or automatic request retry is used.
The DNS query contains the expected domain delegation owner, not the account's
email local part, raw proof, or nonce. The provider's own browser issuance and
privacy behavior require its separate review.

## Browser Behavior And Failure Handling

The form has an email input with `autocomplete="email"` and a hidden input with
`autocomplete="email-verification-token"`. The prepared challenge sets the hidden
input's `nonce` attribute. The browser supplies the proof in that input's `.value`
before ordinary submission. The private facade reads and clears the value and
nonce before awaiting the authenticated verify request; it submits each attempt
once. There is no special proof event, manual token input, or server-emulated
issuance path.

Email input/change clears an earlier proof while retaining the live nonce. An
explicit restart creates a new challenge. Expiry, account/family or epoch change,
lock, logout, dialog close, pagehide, and replacement dispose the attempt. A
different visible email must be corrected or reselected; it cannot select a new
account for verification. Programmatic email prefill is not ownership proof.

Only a fresh authenticated canonical profile with `EmailVerified: true` produces
the verified UI state. `mfaVerified` is unchanged. An empty proof reports
`proofUnavailable` without guessing its cause. The current screen has no complete
ordinary mail-link verification fallback and must say so truthfully; existing
server mail endpoints alone do not supply that user flow.

| Signal                                              | Meaning and next action                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `501 unsupported_feature`                           | Feature is disabled or the account domain has no accepted issuer; use the ordinary account flow and review configuration separately |
| `400 invalid_request`                               | Invalid origin/body, mismatched, expired, or consumed proof; correct the account email if needed and prepare a new attempt          |
| `429 rate_limited`                                  | Wait for the stated retry window; do not replay a disposed presentation automatically                                               |
| `503 server_misconfigured`                          | Review flag, exact RP origin, and registry configuration                                                                            |
| `503 email_verification_issuer_unavailable`         | Review safe DNS/metadata/JWKS failure evidence; do not bypass the trust checks                                                      |
| `503 database_unavailable` or an ambiguous response | Read canonical account state before preparing a new attempt; do not replay the old proof                                            |
| `proofUnavailable`                                  | No proof was obtained; the UI cannot identify browser, trial, provider, consent, or session as the cause                            |

Operational diagnostics use request ID, operation, and bounded failure reason.
Never attach provider responses, JWT text, nonce, authorization headers, or private
account observations to logs, screenshots, public evidence, or support messages.

## Verification And Rollback

With prepared dependencies and an appropriate isolated verification lane, the
normal source gates remain:

```sh
pnpm check
pnpm lint
pnpm test
pnpm admin:build
pnpm format
```

The suite must establish independent issuer/holder signatures, malformed and
unsupported representations, age/skew boundaries, the shared network budget and
stalled-body cancellation, same-family replay, state changes during verification,
and rollback for SQL failure and
`RAISE(IGNORE)`. Browser tests must cover ordinary submit capture, empty proof,
disposal, truthful failure, and fresh canonical state readback. Document-route
tests must cover exact-origin HTML GET/HEAD delivery, header exclusion, invalid
configuration, and removal of upstream trial headers. Record actual D1
execution separately from mocked repository tests. These synthetic checks do
not establish a live provider's draft/algorithm or Origin Trial interoperability.

The [company local build instructions](company-administration.md#local-build-and-loopback-verification)
describe loopback development. A loopback HTTP form cannot satisfy this EVP
profile's exact configured HTTPS RP origin; ordinary UI development is not live
EVP acceptance. Use synthetic trust adapters in tests, and an actually registered
HTTPS origin for browser/provider acceptance.

Rollback sets `HONOWARDEN_EMAIL_VERIFICATION_ENABLED` to `"false"`, which also
stops the built-in trial header, and clears optional trial-token configuration
and any separately supplied trial exposure. Preserve the schema, recorded
email-verification state, account data, and audit history. Disabling EVP does not
reset verification, wipe keys, alter required MFA, revive revoked authority, or
relax issuer/signature/nonce checks. Resolve an ambiguous prior result through
canonical profile readback; a later attempt requires a fresh challenge.
