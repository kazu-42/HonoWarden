# Incident Response Runbook

Last reviewed: 2026-07-09.

HonoWarden is pre-alpha. This runbook is for security and operations incidents
that affect the Cloudflare Workers API, D1/R2 data stores, website, Email
Routing, Linear/GitHub evidence, or operator-managed secrets.

Do not paste real secrets, bearer tokens, refresh tokens, password hashes,
private forwarding destinations, mailbox contents, encrypted vault payloads, or
backup object bodies into issues, chat, Linear, GitHub comments, or public
documents.

## Incident Classes

| Class                                   | Examples                                                                                                                                  | Initial severity |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Token or secret exposure                | `HONOWARDEN_TOKEN_SECRET`, access-token signing keys, `HONOWARDEN_TOTP_SECRET`, bootstrap token, Cloudflare key, Linear key, GitHub token | high             |
| Vault data exposure suspicion           | public logs, backup directory leak, D1/R2 object exposure, accidental response-body capture                                               | high             |
| Email abuse or disclosure inbox failure | forged report flood, route disabled, destination unavailable, metadata published while delivery fails                                     | medium           |
| Cloudflare account compromise           | unauthorized deploy, DNS/MX change, Worker route change, D1/R2 mutation, account member change                                            | critical         |
| Availability regression                 | unhealthy Worker deploy, migration mismatch, website outage, Email Routing outage                                                         | medium           |

Escalate severity when user data, secrets, or account control may be affected.
Downgrade only after readback proves the affected boundary is isolated.

## Detection

Use the lowest-noise evidence available first:

- GitHub Actions run, PR, branch, and release events.
- Cloudflare Worker deployment status, version status, and live `/health`,
  `/healthz`, `/health/db`, `/api/config`, and synthetic prelogin checks.
- Cloudflare Email Routing route, DNS, and activity-log readback with redacted
  sender/message identifiers only.
- D1 schema and row-count readback when data integrity is questioned.
- R2 object list or backup manifest readback when object exposure is questioned.
- Linear issue comments and project state for operator approvals and incident
  timeline.

Record timestamps in UTC and, when useful for the operator, JST. Include command
names, run IDs, commit SHAs, Worker version IDs, D1/R2 resource names, and
redacted hash tags. Do not record secret values or message content.

## Triage

1. Assign an incident lead in Linear.
2. Create or identify the incident issue and add the label or title prefix
   `incident`.
3. Set the impact boundary: API Worker, website, Email Routing, D1, R2, secrets,
   GitHub, Linear, or Cloudflare account.
4. Freeze unrelated deploys and config changes until the incident lead records a
   continue/hold decision.
5. Collect read-only evidence before mutating state unless active compromise
   requires immediate containment.
6. Decide whether the incident affects real user data. If uncertain, treat it
   as sensitive until disproven.

Minimum triage packet:

- incident start time and detection source
- suspected class and severity
- affected environment: local, staging, production, website, or account-wide
- current commit, Worker version, deployment ID, and route/DNS state
- known affected accounts or redacted target hashes
- containment decision and owner
- next verification command

## Containment

Prefer reversible, narrowly scoped containment. Avoid deleting evidence before
capture.

### Token Or Secret Exposure

1. Stop new deploys and disable any automation using the exposed credential.
2. Revoke or rotate the exposed credential in its source system.
3. For access-token signing key exposure
   (`HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET` or a key inside
   `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`), remove the exposed `kid` from the
   verifier set or replace it with a new active key, then verify old tokens with
   that `kid` fail while unaffected previous or legacy tokens still follow the
   intended staged-rotation window.
4. For `HONOWARDEN_TOKEN_SECRET`, plan forced re-login because refresh-token
   hash lookup and legacy no-kid access-token fallback are invalidated by
   rotation.
5. For `HONOWARDEN_TOTP_SECRET`, use the TOTP secret rotation runbook to choose
   rewrap, backup restore, or force re-enrollment. Do not change the runtime
   secret until the D1 envelope plan and rollback path are approved.
6. For `HONOWARDEN_BOOTSTRAP_TOKEN`, rotate and keep bootstrap disabled unless
   the incident lead explicitly approves a short bootstrap window.
7. Run the session/device invalidation path when tokens, refresh sessions, or
   device credentials may be exposed. Use user/device-scoped revoke routes or
   account lifecycle disablement before considering broad database edits.

References:

- [Secrets Inventory](secrets-inventory.md)
- [Authentication State Machine](auth-state-machine.md)
- [Access Token Key Rotation](../operations/access-token-key-rotation.md)
- [TOTP Secret Rotation](../operations/totp-secret-rotation.md)
- [Account Lifecycle Operator Runbook](../operations/account-lifecycle.md)

Formal rotation execution is tracked separately by `HON-60`.

### Vault Data Exposure Suspicion

1. Stop writes to the affected environment when practical.
2. Preserve the suspicious response/log/backup artifact in a restricted
   operator location, then redact evidence for Linear/GitHub.
3. Check whether the artifact contains only encrypted payloads or also
   operational metadata such as account IDs, device IDs, token hashes, backup
   paths, or object keys.
4. If backup material is involved, treat the whole backup directory as
   sensitive even when payloads are encrypted.
5. If data integrity is affected, restore into fresh D1/R2 targets only. Do not
   restore over the original alpha production resources.

References:

- [Data Flow](data-flow.md)
- [Backup And Restore Runbook](../operations/backup-restore.md)
- [Rollback Guide](../release/rollback-guide.md)

### Email Abuse Or Disclosure Inbox Failure

1. Confirm Cloudflare Email Routing `enabled` state, route IDs, DNS record IDs,
   and activity-log delivery status.
2. If delivery to `security@honowarden.com` fails, remove public metadata by
   rolling the website Worker back to the recorded no-security-metadata version.
3. If abuse is routed through project aliases, disable the affected route first
   rather than disabling all Email Routing unless the domain-wide receiver is
   compromised.
4. Preserve only redacted activity-log fields: route, timestamp, action, status,
   SPF/DKIM/DMARC, spam score, and hash tags for sender/message IDs.

References:

- [Email Routing Evidence](../release/email-routing-evidence.md)
- [Website Live Evidence](../release/website-live-evidence.md)
- [Operations Rollback Evidence](../release/ops-rollback-evidence.md)
- [Website And Email Operations](../operations/website-email.md)

### Cloudflare Account Compromise

1. Treat the incident as critical until account control is proven.
2. Freeze Worker deploys, DNS mutations, Email Routing changes, and secret
   writes.
3. Use an out-of-band trusted operator session to review account membership,
   API tokens, global keys, recent Worker deployments, DNS/MX records, D1/R2
   resources, and routes.
4. Rotate affected Cloudflare credentials and remove unknown tokens or members.
5. Redeploy the reviewed Worker versions or roll back website metadata only
   after account control is restored.

References:

- [Operator Environment](../operations/operator-environment.md)
- [Cloudflare Resource Evidence](../release/cloudflare-resource-evidence.md)
- [Operations Rollback Evidence](../release/ops-rollback-evidence.md)

Cloudflare account access review is documented in
[Cloudflare Access-Control Review](../operations/cloudflare-access-control.md).
Scoped HonoWarden Cloudflare tokens are available for normal operations;
account-level 2FA enforcement, legacy-token retirement, and global-key rotation
remain operator hardening work.

## Communication

Use Linear as the incident timeline. GitHub PR comments should hold only
reviewable code/evidence context, not sensitive incident details.

Internal update template:

```text
Incident:
Severity:
Lead:
Started:
Current state: investigating | contained | recovering | monitoring | closed
Affected boundary:
Known user impact:
Actions taken:
Next readback:
Decision needed:
```

External communication is not automatic in alpha. Publish a user-facing update
only after the incident lead confirms impact, affected data classes, mitigation,
and whether security contact delivery is functioning. Do not speculate about
plaintext exposure; HonoWarden stores opaque encrypted vault payloads, but
metadata and backups remain sensitive.

## Recovery

Recovery must prove both service health and control-plane correctness.

For Worker/API incidents:

- redeploy the reviewed release target or a verified safe commit
- verify `/health`, `/healthz`, `/health/db`, `/api/config`, and a synthetic
  auth denial or approved client smoke
- confirm no unexpected migration drift

For website or email incidents:

- verify apex and `www` root routes
- verify `/.well-known/security.txt`, `/security.txt`, and `/health`
- verify Email Routing route IDs, DNS IDs, delivery status, and metadata
  visibility decision

For backup/data incidents:

- restore into fresh targets
- verify manifest hashes
- verify D1 schema health
- verify client or fixture sync against the restored target

For secret incidents:

- rotate or revoke the source credential
- invalidate sessions/devices where applicable
- verify fail-closed behavior before enabling normal traffic

## Postmortem

Close an incident only after:

1. Root cause and affected boundary are recorded.
2. Containment and recovery actions have readback evidence.
3. User/data impact is classified.
4. Follow-up issues exist for every unresolved gap.
5. Evidence excludes secrets, private forwarding destinations, mailbox content,
   and vault data.
6. The incident lead records a final continue/hold decision.

Postmortem template:

```text
Summary:
Timeline:
Detection:
Impact:
Root cause:
Containment:
Recovery:
What worked:
What failed:
Follow-up issues:
Evidence links:
```

## Tabletop Evidence

The first tabletop exercise is recorded in
[Incident Response Exercise Evidence](incident-response-exercise.md). It covers
a simulated token exposure plus suspicious Email Routing activity and maps the
remaining gaps to Linear issues.
