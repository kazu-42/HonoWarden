# Orchestration: HON-208 WebAuthn contract and RP origin policy

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Treat the completed HON-162 pinned-source results and current HonoWarden code
  as authoritative inputs.
- Keep this child contract-only: no routes, schema, verifier dependency, or
  compatibility promotion.
- Require explicit configured trust roots and deterministic fail-closed output.

## Branching Rules

- If a requested origin cannot be represented as a standard HTTPS Web origin,
  reject it here and create a later explicit native/extension transport decision
  instead of broadening the parser.
- If localhost HTTP is needed, require exact hostname `localhost` plus the
  dedicated opt-in; loopback IPs and subdomains remain rejected.
- If any enabled configuration error exists, return `misconfigured` and make the
  feature unusable; never partially accept a reduced allowlist.
- If pinned compatibility requires implementation behavior, assign it to the
  owning HON-209+ child and keep HON-208 descriptive.
- If independent review finds a trust-boundary bypass or capability overclaim,
  fix it and rerun all focused and repository gates before checkpointing.

## Packet Prompts

### 01-contract

Write an ADR and protocol specification that freeze RP/origin, challenge,
credential, assertion-grant, PRF/Vault unlock, recovery, session, route, and
compatibility boundaries. State which later child owns each state transition.

### 02-policy-tdd

From failing tests, implement a pure runtime-policy parser with a disabled,
ready, or misconfigured result. Canonicalize exact origins, enforce DNS-label RP
matching, gate localhost HTTP separately, bound list size, deduplicate output,
and expose only stable non-secret error codes.

### 03-config-docs

Add optional bindings and blank local examples, pin the feature false in all
tracked Wrangler environments, document operator configuration and threats, and
test that no route or advertised capability has been added.

### 04-independent-review

Review only the HON-208 diff for origin/RP bypasses, URL edge cases,
configuration leakage, pinned-contract inaccuracies, scope creep, rollback
ambiguity, and missing tests. Return actionable findings with file references.

## Completion Audit

HON-208 is source-ready only when all contract/policy/config/docs artifacts agree,
the feature remains absent and disabled, all gates pass, independent findings
are resolved or explicitly rejected with evidence, Linear has an exact
checkpoint, and no GitHub/runtime/external mutation has occurred.
