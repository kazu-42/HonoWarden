# Independent Assessment Finding Template

Use one copy per independent assessment finding. The private report can carry
additional detail; the repository and Linear version must remain redacted.

## Identity

- Finding ID:
- Assessment / `HON-87` link:
- Exact commit and Worker version:
- Affected staging component and route category:
- Reporter and reported-at timestamp:

## Severity

- Severity: critical / high / medium / low / informational
- Likelihood: high / medium / low, with rationale
- Impact: high / medium / low, with affected asset
- Preconditions and attacker capability:
- CVSS vector, when supplied by the independent assessor:

Critical means credible compromise of signing or operator credentials,
pre-authentication code execution, broad authentication bypass, or cross-user
plaintext/secret exposure. High includes repeatable cross-user encrypted vault
access, session takeover, or integrity compromise with practical preconditions.
Severity is confirmed by the project owner and independent assessor; it is not
lowered solely because the service is pre-alpha.

## Security Invariant Violated

State the expected property, such as owner-scoped access, one-time refresh/auth
request consumption, secret-safe logging, staging isolation, or encrypted-only
storage. Link the relevant threat-model boundary and code location.

## Redacted Reproduction

Record the minimum request sequence and observable result needed to reproduce
using synthetic IDs. Remove bearer tokens, access codes, hashes, encrypted key
material, email addresses, object keys, private hostnames, and raw payloads.
Keep exploit-ready detail in the approved private evidence channel until the
fix and disclosure decision are complete.

## Evidence

- Private evidence location and custodian:
- Redacted logs or response classification:
- Affected synthetic account IDs (hashed tag only):
- First known affected commit / version:
- Last verified affected commit / version:

## Remediation Owner And SLA

- Linear issue:
- Engineering owner:
- Due date:
- Containment required before fix: yes / no
- Critical/high real-secret-use gate: blocked / not applicable
- Fix PR and merge commit:
- Deployment/readback evidence:

Default targets are immediate containment for critical findings, a reviewed fix
and independent retest before any real-secret use for critical/high findings,
and owner-agreed dates for medium/low findings.

## Independent Retest

- Assessor:
- Exact fixed commit and Worker version:
- Retest timestamp and authorized window:
- Result: fixed / partially fixed / not fixed / regression
- Regression tests added:
- Residual risk:

Implementation-agent tests are useful but do not replace independent retest for
critical/high findings.

## Risk Acceptance

Risk acceptance is exceptional and must include owner, expiration/review date,
business rationale, compensating controls, affected environments, and the
independent assessor's residual-risk statement. Silence, backlog placement, or
pre-alpha status is not acceptance. Critical/high acceptance blocks real-secret
use unless the project owner explicitly records otherwise.

## Closeout

- Synthetic data and credentials removed with readback:
- Public disclosure or advisory decision:
- Security docs and known limitations updated:
- Linear status changed only after remediation or time-bounded acceptance and
  required independent retest evidence are recorded:
