# Result 02: Policy TDD

Status: accepted after independent-review fixes.

## Red And Green Evidence

1. The first focused test failed because `src/domain/webauthn.ts` did not exist.
2. The initial implementation passed 31 policy cases.
3. Independent review reproduced seven WHATWG normalization bypasses: backslash,
   dot segments, percent-encoded host, Unicode host mapping, embedded control,
   and non-canonical default port. Seven regression cases failed before the raw
   serialization guard and all passed afterward.
4. Re-review found Kelvin-sign case folding converging to ASCII `k`. Its
   regression failed before a visible-ASCII gate and passed afterward.
5. The final focused domain suite passes 39 cases.

## Accepted Behavior

- Missing, blank, or false enablement returns `disabled` and ignores incomplete
  inactive trust roots.
- Ambiguous flags and any enabled policy defect return `misconfigured`, no
  partial allowlist, and deterministic non-secret error codes.
- RP IDs are canonical lowercase DNS names with a label boundary, or exact
  `localhost`; IPs, wildcards, schemes, ports, malformed labels, and production
  single labels fail.
- Origins use structured URL parsing plus a raw visible-ASCII serialization
  guard. Only ASCII case folding, an optional root slash, and explicit default
  port removal may normalize.
- HTTPS is mandatory except exact localhost HTTP under a separate true flag.
- Canonical origins are bounded before deduplication, deduplicated, and sorted.

## Residual Risk

The parser is intentionally not a public-suffix list or DNS ownership verifier.
HON-209 must still use a maintained verifier, and activation requires operator
control/readback of the configured RP and origins.
