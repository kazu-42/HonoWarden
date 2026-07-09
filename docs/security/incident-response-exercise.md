# Incident Response Exercise Evidence

Exercise date: 2026-07-09.

Status: passed.

Mode: tabletop, read-only dry-run evidence, and formal secret rotation dry-run
boundary. No real secret rotation, production account mutation, mailbox content
review, or vault-data access was performed.

## Scenario

Simulated combined incident:

1. A local operator reports that a token-like value may have been pasted into an
   internal note.
2. At the same time, the public `security@honowarden.com` route receives unusual
   inbound traffic.
3. The incident lead must determine whether to rotate runtime secrets, remove
   public security metadata, roll back a Worker, disable accounts, or hold for
   more evidence.

The exercise intentionally combines a secret-exposure suspicion with an email
abuse signal because those paths touch different control planes: Wrangler
secrets, Cloudflare account credentials, Email Routing, website metadata,
Linear, and GitHub evidence.

## Roles

| Role                 | Exercise owner                                |
| -------------------- | --------------------------------------------- |
| Incident lead        | Codex operator session                        |
| Evidence recorder    | Codex operator session                        |
| Cloudflare operator  | Deferred to human operator for real rotations |
| Communications owner | Deferred until confirmed user impact exists   |

No customer/user communication was sent because this was a tabletop exercise
with no confirmed impact.

## Detection And Triage

Read-only checks used during the exercise:

- `docs/security/secrets-inventory.md` identifies runtime secrets and rotation
  failure modes.
- `docs/release/ops-rollback-evidence.md` identifies API Worker recovery and
  website metadata rollback commands.
- `docs/release/email-routing-evidence.md` records six verified Email Routing
  rules, DNS handles, and passed inbound smoke without private mailbox values.
- `docs/operations/account-lifecycle.md` provides dry-run-first disable/enable
  commands for account containment.
- `docs/operations/backup-restore.md` confirms restore should target fresh
  resources only.
- `docs/operations/secret-rotation-drill.md` provides the formal dry-run
  credential-class matrix without rotating live secrets.
- `direnv exec . pnpm ops:readiness:packet -- --strict --tag-workflow-run-id
28863312935 --tag-workflow-url
https://github.com/kazu-42/HonoWarden/actions/runs/28863312935` returned
  `ready` in the current operations evidence stream before this exercise.

Triage packet produced by the exercise:

| Field               | Exercise value                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Severity            | high until secret exposure is disproven                                                                                |
| Affected boundary   | runtime secrets, Cloudflare Email Routing, website metadata                                                            |
| User data impact    | unknown, treat backups/logs as sensitive                                                                               |
| Immediate action    | freeze unrelated deploys and gather read-only evidence                                                                 |
| Initial containment | revoke exposed operator credential if confirmed; hold runtime secret rotation until scope is known                     |
| Metadata decision   | keep `security@honowarden.com` published while delivery remains verified; roll back website metadata if delivery fails |

## Containment Decisions

Token-like value:

- Do not paste the value into Linear or GitHub.
- Identify the source system out of band.
- If the value is a Cloudflare, Linear, GitHub, or Wrangler secret, revoke it at
  the source and record only the credential class and revocation timestamp.
- If `HONOWARDEN_TOKEN_SECRET` is affected, plan forced re-login and session
  invalidation before rotation.
- If `HONOWARDEN_TOTP_SECRET` is affected, do not rotate blindly; open or use
  the existing TOTP wrapping-secret rotation work because encrypted setup
  secrets require a migration or re-enrollment plan.

Email abuse signal:

- Confirm route status and activity-log delivery with redacted message/sender
  hash tags only.
- Keep the public security metadata if delivery is still verified.
- If delivery fails, run the website rollback command recorded in
  `docs/release/ops-rollback-evidence.md` to remove public security metadata,
  then recheck apex and `www` homepage, `/.well-known/security.txt`,
  `/security.txt`, and `/health`.
- Disable only the abusive route when the route-level boundary is clear; avoid
  disabling all Email Routing unless domain-wide receiving is compromised.

Cloudflare compromise escalation:

- If any unauthorized Worker deployment, DNS/MX mutation, Email Routing change,
  account member change, or API token appears, treat the incident as critical.
- Freeze all Cloudflare writes until account control is restored.
- Use an out-of-band trusted operator session for account review and token
  removal.

## Recovery Checks

The exercise requires these checks before closing a real incident:

- API Worker: `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic
  prelogin denial.
- Website: apex and `www` root, `/.well-known/security.txt`, `/security.txt`,
  and `/health`.
- Email: route IDs, DNS IDs, destination verification status, activity-log
  delivery status, and metadata visibility decision.
- Secrets: credential revoked or rotated at source, affected sessions/devices
  invalidated where applicable, and fail-closed behavior verified.
- Data: backup restore only into fresh D1/R2 targets; no in-place alpha restore.

## Gaps And Follow-Up Issues

| Gap found during tabletop                                                                                               | Follow-up                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Formal secret rotation dry-run is complete; live credential rotation remains intentionally unexecuted                   | future live rotation window                |
| Cloudflare account scoped-token rollout is complete, but 2FA/global-key hardening remains                               | access-control review / operator hardening |
| Independent security audit and external penetration test are not complete                                               | `HON-57`                                   |
| Worker runtime Logpush to R2 is configured, but SIEM/vendor alerting and automated retention deletion remain follow-ups | `HON-49`                                   |
| Inquiry mailbox retention/redaction workflow is not implemented                                                         | `HON-24` through `HON-27`                  |
| Live two-user disabled-account lifecycle evidence is not recorded                                                       | `HON-61`                                   |

No new issue was required for the tabletop itself. Rows above either map to
existing follow-up issues or to explicit operator-owned future windows where
live mutation was intentionally deferred. If any gap recurs without an existing
issue or an intentional deferral, create the issue before closing the incident.

## Outcome

Result: passed for tabletop readiness.

The runbook covers detection, triage, containment, communication, recovery, and
postmortem steps for the requested incident classes. The exercise produced a
continue/hold decision model without changing production state.

Residual risk:

- This is not a live incident or live rotation.
- The project still needs the follow-up issues listed above before handling real
  secrets or real vulnerability reports as production-ready operations.
- Evidence remains intentionally redacted and does not prove mailbox content,
  private forwarding destinations, or real vault-data handling.
