# ADR 0017: Email Verification Protocol As A Bounded Relying Party

## Status

Accepted implementation contract, 2026-10-04. This is an experimental,
default-disabled extension to the company browser in
[ADR 0016](0016-company-administration.md). Source delivery, synthetic verification,
runtime activation, Origin Trial registration, and actual provider/browser
acceptance are separate outcomes. This ADR does not establish the latter outcomes;
consult the [current state](../current-state.md) for their recorded evidence.
HonoWarden remains pre-alpha.

The wire profile is the individual IETF Internet-Draft
[draft-hardt-email-verification-02](https://datatracker.ietf.org/doc/html/draft-hardt-email-verification-02),
published 25 August 2026 and expiring 26 February 2027. It is work in progress,
not an RFC. The June 2026
[WICG report](https://wicg.github.io/email-verification/) is a Draft Community
Group Report, not a W3C Standard. These source pins follow the protocol research
packet read on 2026-10-04; they do not claim continued trial or provider availability.

## Context

An email provider can attest email ownership to a relying party while a browser
binds that attestation to its own key and the RP's nonce. This can provide an
additional way to mark an existing account's email as verified. It does not prove
knowledge of a master password or a TOTP factor, or decrypt a vault.

The first company phase uses email, master password, and TOTP, with SSO later.
Email Verification Protocol (EVP) remains separate from that authentication and
organization-access contract. An unauthenticated proof must not create an account,
select another account, issue a session, or bypass current-family MFA.

Published examples differ across draft and browser versions. The
[July Chrome announcement](https://developer.chrome.com/blog/email-verification-protocol-origin-trial)
has an out-of-date warning, and the
[August update](https://developer.chrome.com/blog/email-verification-august-2026)
changes browser-entry and issuance guidance. Examples include algorithm names,
key metadata, email comparison, and future disclosure handling that differ from
the pinned draft. Accepting those differences implicitly would change the trust
contract without an explicit protocol decision.

## Decision

### Current Authenticated Account Only

HonoWarden acts only as the RP. It receives a presentation produced by the browser
and issuer; it does not issue attestations or emulate browser-to-provider issuance.
Both POST routes require an existing authenticated account and an exact active
user/device/session family. The HTTP `Origin` must equal the configured HTTPS RP
origin byte for byte, and queries are rejected.

The actor is `{ userId, sessionId, deviceIdentifier, emailNormalized,
securityStamp }`. Challenge creation, lookup, and consumption recheck the active
account, unchanged canonical email and security stamp, and exact unrevoked device
family in SQL. A token claim or a successful earlier lookup cannot authorize a
later commit after account disablement, email change, revocation, or family
replacement. The signed email must equal the current canonical account email
exactly; the verifier does not trim, change case, fold aliases, or change the
account's email.

The API contract is:

| Method | Path                                              | Body                   | Success                                                                                                    |
| ------ | ------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/identity/accounts/email-verification/challenge` | `{}`                   | `object: emailVerificationChallenge`, `challengeId`, `nonce`, `email`, `audience`, `expiresAt`, `protocol` |
| POST   | `/identity/accounts/email-verification/verify`    | `{challengeId, token}` | `{"object":"emailVerification","verified":true,"method":"evp"}`                                            |

Bodies are strict JSON objects, with a 16 KiB body limit and a 15 KiB proof limit.
Duplicate JSON members and invalid UTF-8 fail. All responses use `no-store`.
Disabled or unsupported-domain operations return `501 unsupported_feature`;
misconfiguration and unavailable trust infrastructure return reported `503`
errors. Invalid, expired, mismatched, and consumed proofs share an invalid-request
response rather than disclosing internal proof details.

### Five-Minute, Single-Use, Transactional Challenge

Generate a 32-byte cryptographically random nonce, valid for 300 seconds. Store
only its purpose-prefixed SHA-256 digest. Migration
[0031](../../migrations/0031_email_verification.sql) creates
`email_verification_challenges` with the account/family/email/stamp/audience
snapshots, creation and expiry times, and a unique `(user_id, session_id)` key.
Preparing another challenge replaces that family's old challenge and invalidates
its previous ID and nonce. Raw presentations and raw nonces are not persisted.

`consumed_at` and the random UUID `verification_mutation_id` must be either both
null or both set. The repository conditionally consumes the unexpired challenge,
updates the same account, and inserts the required `account.email.verify` success
audit in one D1 batch. Internal SQL assertions abort the batch if the dependent
account update or mandatory audit INSERT is silently ignored, as well as on an
ordinary SQL failure. Concurrent submissions can produce only one successful
consumption; identical timestamps cannot substitute for the mutation marker.

The account write preserves an existing `email_verified_at` timestamp, updates
`updated_at`, and advances `revision_date` monotonically. The audit targets the
account and records only `method: evp` and the pinned protocol in its context.
It does not record the presentation, nonce, or provider claims. This account event
is separate from the custom organization administration event projection.

The operation does not change authentication credentials, access/refresh tokens,
security stamp, TOTP enrollment or session assurance, organization membership,
policy, or encrypted key material. A new verified email state cannot unlock a
vault or revive a revoked session or membership.

### Fixed Trust Registry And Bounded Network

Server configuration contains 1–16 distinct exact email-domain entries, each
with only `emailDomain`, `issuer`, and `jwksUri`. It is an acceptance allowlist,
not automatic discovery or a replacement for DNS delegation. No registered
domain means no supported issuer. Never derive an issuer from MX records,
provider branding, caller URLs, or an ordinary OIDC `email_verified` claim.

For an uncached accepted entry, the server makes at most three sequential GETs:

1. The fixed `https://cloudflare-dns.com/dns-query` resolver for the exact
   `_email-verification.<account-domain>` TXT owner.
2. The registered issuer's `/.well-known/email-verification` metadata.
3. The exact registered `jwksUri`.

Require one TXT record, with valid concatenated TXT string chunks, whose `iss=host`
delegation yields exactly the registered HTTPS issuer origin. Reject mismatched
owners, multiple answers, CNAME discovery, and malformed delegation. Metadata must
repeat the exact issuer and registered JWKS URL. Its issuance endpoint is validated
but never fetched by this RP. A separately hosted JWKS is allowed only through its
explicit reviewed registry URL.

The complete uncached DNS, metadata, and JWKS resolution shares one five-second
deadline, including response streaming. Each GET receives only the remaining
budget; a later request does not restart the clock. Every document has a 64 KiB
body limit, allowed JSON MIME types, strict decoding, and redirect rejection.
JWKS contains 1–32 keys. Cache entries are keyed by the registry tuple, bounded to
16 entries, and expire after the smaller of the DNS TTL and 60 seconds. Expired
trust has no stale-data fallback. These controls bound accepted destinations and
resource use; they do not claim DNSSEC validation or arbitrary Internet discovery.

Account-scoped quotas admit at most five challenge and ten verification requests
per 60-second window before expensive resolution. Unsupported domains do not
create challenge state or trigger provider network access.

### Strict Draft-02 Cryptographic Profile

Accept only an unchanged compact EVT JWT, one `~`, and a compact KB-JWT. Verify
both signatures with distinct issuer and issuer-authenticated holder keys. The
KB `sd_hash` is SHA-256 over the original serialized EVT including its trailing
`~`; reserializing claims changes the signed representation.

Allow only fully specified `Ed25519` and `ES256`, exact `evt+jwt`/`kb+jwt` types,
public Ed25519 or P-256 keys, and strict signature lengths. The selected issuer
`kid` must identify one unique JWKS key. A holder key's `alg` is mandatory and must
match KB; an issuer JWKS key may omit `alg`, but an explicit value must match EVT.
EVT must also use an algorithm advertised by metadata, which defaults to
`Ed25519` when that metadata field is absent. There is no inferred algorithm,
`EdDSA` compatibility alias, token-selected key URL, or login-JWT verifier reuse.

Require boolean `email_verified: true`, byte-exact email and scalar audience,
the current nonce digest, and finite nonnegative NumericDate timestamps. Both
JWTs have maximum age 300 seconds and future skew at most 30 seconds; fractional
timestamps are permitted. An optional expiry must be later than issuance and
unexpired. These age limits are application policy; the draft does not require
an `exp` claim. Reject disclosures, `_sd`, `_sd_alg`, extra separators, ambiguous
JSON, and unsupported key/algorithm representations explicitly.

### Ordinary Browser Form, Private Attempt

The browser uses an ordinary form containing an email input with
`autocomplete="email"` and a hidden input with
`autocomplete="email-verification-token"`. Preparation sets the hidden input's
`nonce` attribute to the server challenge. At ordinary form submission, the
facade copies the browser-populated hidden input's `.value`, clears it and removes
the nonce synchronously, then sends the proof through the private authenticated
API facade. There is no EVP-specific JavaScript proof event, manual proof entry,
or programmatic `form.submit()` substitute for browser issuance.

An attempt is used once and disposed on expiry, replacement, account/family or
epoch change, lock, logout, pagehide, and dialog close. Email edits clear any old
proof while retaining the live nonce. The visible email comparison permits the
account's existing trim/lowercase normalization; signed-claim comparison remains
exact. The attempt, raw proof, nonce, and tokens are not exported to persistent
state, storage, URLs, or logs. JavaScript string clearing does not promise perfect
erasure from a compromised browser.

An empty hidden value yields `proofUnavailable`; it cannot diagnose the browser,
trial, issuer, consent, or account-session cause. Success requires a fresh
canonical authenticated profile readback with `EmailVerified: true`. It never
sets `mfaVerified`. The current screen does not implement a complete mail-link
fallback and must not imply one.

## Consequences And Verification

Strict rejection reduces ambiguity and prevents a provider proof from changing
account or organization authority. It may reject a currently issued browser proof
whose algorithm or claims follow another revision. Supporting that representation
needs an explicit reviewed protocol change, independent signature vectors, and
actual interoperability evidence; weakening the verifier is not a recovery path.

The administration asset route can deliver an optional first-party `Origin-Trial`
header using `HONOWARDEN_EMAIL_VERIFICATION_ORIGIN_TRIAL_TOKEN`, whose tracked
value is empty in every scope. The app supplies this option only when EVP policy
is ready and the token is nonempty. Only successful `200` HTML GET/HEAD documents
at the exact configured RP origin receive it, including supported invitation
entry documents. Origin matching uses the actual request URL, not forwarded
headers. Assets, APIs, redirects, errors, disabled routes, and upstream asset
headers cannot supply trial exposure.

The server bounds the option to one canonical standard-Base64 value of at most
8192 characters and validates the canonical HTTPS origin. Invalid supplied
configuration produces a sanitized, reported document `503`. The browser
validates the token's authenticity, trial, origin, and expiry; server syntax
validation and header delivery do not establish those facts.

Origin Trial registration remains an operator action outside this source.
Operators must establish the exact RP origin's current trial eligibility,
public domain delegation, documented issuer metadata and keys, and a real
synthetic browser/provider flow before claiming availability. Browser trial
availability does not establish a Microsoft 365 or other provider's issuer
contract. No guessed Microsoft issuer or OIDC substitution is admitted.

Verification must cover independent issuer/holder signature vectors, malformed
representations, timestamp boundaries, the shared network deadline and cancellation,
exact-family races, one-winner replay, and rollback under both failed and ignored dependent
writes. Browser evidence must cover ordinary submit, unavailable proof, disposal,
and canonical state readback. Synthetic signatures alone do not prove a live
provider's draft/algorithm compatibility.

Rollback disables EVP and removes any separately supplied trial exposure while
preserving recorded email-verification state and ordinary authentication. It does
not relax validation, reset account state, erase data, or create an access bypass.
See the [operator contract](../operations/email-verification.md) for preflight,
failure handling, and acceptance evidence.
