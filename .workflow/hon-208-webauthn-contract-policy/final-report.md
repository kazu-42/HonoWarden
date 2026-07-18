# Final Report: HON-208 WebAuthn contract and RP origin policy

## Outcome

HON-208 is locally source-ready on `feat/hon-208-webauthn-contract-policy`.
The candidate defines the pinned protocol/recovery contract and a pure,
default-off RP/origin policy without adding a WebAuthn route, state, verifier,
runtime activation, or compatibility claim. Linear remains In Progress pending
the separate GitHub publication and merge gate.

## Accepted Results

- ADR 0012, pinned wire/state specification, dedicated threat model, and
  operator policy documentation.
- Deterministic `disabled`, `misconfigured`, and `ready` runtime policy with
  stable non-secret errors and no partial allowlist.
- Exact lowercase RP/DNS-label checks, HTTPS enforcement, explicit localhost
  HTTP opt-in, bounded/sorted/deduplicated origins, and raw visible-ASCII
  serialization validation.
- Four optional bindings, blank local trust-root placeholders, and WebAuthn
  enablement false in every tracked Wrangler environment.
- Tests proving route, migration, dependency, and capability advertisement
  remain absent in this child.
- Vitest exclusion of `.workflow/**` while preserving default exclusions, so
  Node-native workflow tests remain independently executable.
- Idempotent HON-208 Linear source-ready checkpoint plus separate exact
  readback.

## Rejected Results

- Request-derived RP/origin policy and reuse of CORS/public-origin helpers.
- Wildcards, credentials, paths, queries, fragments, custom schemes, IP RP IDs,
  cross-RP hosts, production HTTP, malformed ports, or partial valid allowlists.
- WHATWG repair of backslashes/dot segments/encoded hosts and Unicode/IDNA case
  folding into a trusted origin.
- Treating assertion authentication as PRF-backed Vault unlock, accepting PRF
  output at the server, or returning another credential's encrypted key set.
- Pulling migration 0015, verifier dependency, routes, token/session behavior,
  or live authenticator work forward from HON-209 through HON-214.

## Conflicts Resolved

- The pinned server uses a broader 17-minute assertion token. HonoWarden chooses
  seven minutes for login and retains 17 minutes only for multi-step PRF key-set
  update.
- The pinned client has no rename API. HonoWarden rename is documented as an
  authenticated extension owned by HON-212, not official compatibility.
- The pinned replay cache uses separate read/set operations. HonoWarden requires
  a D1 atomic single-winner transition in HON-209.
- Independent review found two URL-normalization defects. Both were reproduced
  with failing tests, fixed with narrow serialization plus visible-ASCII guards,
  and closed by final reviewer readback with no remaining findings.

## Verification Evidence

- Focused final suite: 4 files, 62 tests passed; policy subset 39/39.
- Full suite: 80 files, 817 tests passed.
- `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm brand:scan`, and
  `git diff --check`: passed.
- HON-162 Node plan tests: 4/4; HON-162 and HON-208 workflow verification:
  passed.
- Wrangler dry-run: top-level, staging, and production passed, each reading
  WebAuthn enablement false.
- Linear independent readback at `2026-07-18T19:12:17.426Z`: issue HON-208,
  In Progress, non-archived, parent HON-162, expected project/priority, one
  managed comment, exact 2001-byte body, SHA-256
  `e9475b47726f4e860b0810579ba06365520d1f36d85fc489ff391d92590d86aa`.

## Remaining Risks

- No Git commit, push, PR, CI, review thread, merge, or main-branch readback has
  occurred. HON-208 intentionally remains In Progress and HON-209 remains
  blocked.
- Public-suffix validity and DNS control are not established by the pure parser;
  operator and maintained-verifier checks remain required.
- The verifier dependency, D1 credential/challenge state, atomic concurrency,
  routes, token method, TOTP decision, lifecycle/session revocation, deployment,
  and real authenticator evidence belong to later children.
- Browser extension, Web, Desktop, mobile, CLI, localhost, custom-domain,
  staging, production, and authenticator compatibility remain unverified.

## Reusable Follow-up

HON-209 must consume `resolveWebAuthnRuntimePolicy` as its only trust-policy
input and use ADR 0012, the wire/state contract, and the threat model as
acceptance criteria. It must not reintroduce request-derived trust or loosen the
raw origin serialization rules. The GitHub publication gate for HON-208 must run
repository review rules, CI, merge/main readback, and a post-merge Linear
checkpoint before closing HON-208 or advancing HON-209.
