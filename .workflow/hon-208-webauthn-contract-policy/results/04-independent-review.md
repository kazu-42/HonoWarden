# Result 04: Independent Review

Status: accepted after two TDD correction rounds.

## Findings And Resolution

1. **Medium: WHATWG normalization accepted malformed raw origins.** The reviewer
   reproduced backslash repair, normalized dot segments, percent-encoded host,
   Unicode host mapping, embedded controls, and non-canonical default ports.
   Seven focused regressions failed before the fix. The accepted fix compares
   raw input with a narrow canonical serialization set while retaining the
   structured URL parser.
2. **Medium: Unicode-aware case folding bypassed the first guard.** Kelvin sign
   lowercased and IDNA-mapped to ASCII `k`. Its focused regression failed before
   the fix. The accepted fix rejects every non-visible-ASCII raw origin before
   case folding.

The final reviewer readback was: `resolved; no remaining findings`. The domain
suite passed all 39 cases after the final fix. No reviewer edited files or made
an external write.

## Confirmed Boundaries

- No route, migration, verifier dependency, persistence, feature advertisement,
  runtime activation, or live compatibility claim was added.
- Misconfigured output exposes stable codes only and no partial trust policy.
- Every tracked environment remains disabled and contains no real RP/origin.
- The lint-only comments on HON-162 scripts change no behavior.

## Residual Risk

Future changes to accepted visible-ASCII URL syntax or WHATWG serialization need
new focused review. Public-suffix and DNS-control validation remain explicit
operator/verifier responsibilities, not hidden parser claims.
