# Independent Security Assessment Engagement

Status: not authorized. Repository readiness is complete only after this pack
passes review; active testing requires the separate authorization gate in
`HON-87`.

Last reviewed: 2026-07-11.

This document is the rules-of-engagement template for an independent security
assessment of HonoWarden. It is not an audit report, authorization to test, or
evidence that an assessment has happened. The assessor must be independent of
the implementation agent and must receive written authorization from the
project owner before sending test traffic.

## Authorization Gate

Testing is not authorized until all fields below are recorded in the private
`HON-87` engagement record and confirmed by both owner and assessor:

- assessor legal name and primary contact;
- exact Git commit and deployed Worker version under test;
- staging hostnames, D1 database, R2 bucket, and Durable Object namespace;
- UTC start/end window and timezone-aware emergency contact;
- allowlisted source IP or egress ranges;
- maximum request rate and concurrency;
- signed authorization and data-processing terms where applicable;
- cleanup owner and post-test readback appointment.

Absence, ambiguity, or expiration of any field means stop. A repository merge,
Linear assignment, or access to a synthetic credential is not authorization.

## In-Scope Targets

The default technical scope is the exact commit deployed to an isolated
staging environment:

- Worker routes and middleware in `src/app.ts` and `src/index.ts`;
- authentication, token, TOTP, login-defense, request-quota, bootstrap, and
  auth-request logic under `src/domain`;
- owner-scoped repositories and D1 migrations;
- encrypted attachment metadata and R2 object boundaries;
- per-user notification Durable Objects and SignalR framing;
- backup, restore, account-lifecycle, rotation, and evidence CLIs in `scripts`;
- Wrangler staging bindings and environment separation;
- GitHub Actions and dependency/build integrity where explicitly agreed.

The test baseline must name an exact Git commit. Moving `main`, an unpinned
deployment, or local source is not a stable assessment target.

## Out Of Scope

- production is out of scope unless a later signed amendment names a narrow
  target and window;
- Cloudflare infrastructure not owned by the project;
- upstream official clients and their hosted services;
- real user accounts, real vault contents, personal email, or operator devices;
- public aliases, unrelated domains, forwarding destinations, and third-party
  inboxes;
- social engineering, phishing, physical access, employee targeting, and
  denial of service;
- destructive restore, deletion, retention acceleration, or credential
  rotation;
- vulnerability publication before coordinated disclosure completes.

Finding an apparent issue outside scope requires notification to the emergency
contact. It does not expand authorization.

## Synthetic Data Rules

Use only synthetic accounts, devices, ciphers, attachments, auth requests, and
inquiry messages created for the engagement. Synthetic values must not resemble
real credentials or contain personal data. Do not use real secrets even when
the payload is encrypted.

The owner provisions unique, time-bounded test credentials. The assessor must
not receive Cloudflare global keys, production tokens, forwarding destinations,
or operator credentials. Account IDs and request IDs may be retained only in
the private evidence bundle and must be removed from public findings.

## Test Focus

The independent assessor should map tests to the existing threat model and
record both positive and negative evidence for:

1. authentication bypass, credential stuffing controls, token expiry,
   signature verification, refresh rotation, and replay;
2. cross-user reads and writes across sync, folders, ciphers, attachments,
   devices, exports, and auth requests;
3. auth-request requester/approver separation, access-code guessing, state
   transition races, notification leakage, consume atomicity, and replay;
4. TOTP setup/change/disable recent-auth gates and replay resistance;
5. input parsing, oversized bodies, attachment limits, quota bypass, and
   resource exhaustion without load testing;
6. D1 query ownership predicates, migration defaults, R2 object-key isolation,
   and cleanup behavior;
7. bootstrap and unsupported-route fail-closed behavior;
8. audit/log redaction, error responses, cache headers, and identifier leakage;
9. backup/restore path traversal, manifest tampering, target isolation, and
   dry-run/confirmation controls;
10. staging/production binding separation and CI/dependency integrity.

## Prohibited Actions

- Do not test production or any hostname not listed in the signed scope.
- Do not exceed the approved request rate or run stress/load tests.
- Do not delete, corrupt, ransom, retain, or publish data.
- Do not access another tester's synthetic account unless the owner created it
  specifically for cross-user isolation testing.
- Do not exfiltrate tokens, ciphertext, logs, backups, or object bodies beyond
  the minimum redacted proof required for a finding.
- Do not change DNS, Email Routing, Cloudflare members, API tokens, secrets,
  deployments, retention, or GitHub settings.
- Do not attempt persistence, lateral movement, platform escape, supply-chain
  publication, or contact with third parties.

## Stop Conditions

Stop all testing and contact the owner immediately when any of these occurs:

- evidence of real user or operator data;
- cross-account access beyond the pre-created synthetic pair;
- production traffic or an unlisted hostname appears in the path;
- material availability degradation, elevated error rate, or quota exhaustion;
- credential, signing-key, backup, or Cloudflare control-plane exposure;
- destructive mutation or an unexpected retention/cleanup action;
- scope, source IP, contact, deployment commit, or test window no longer
  matches the authorization record.

The owner decides whether to contain, preserve evidence, rotate credentials, or
resume. The assessor does not self-authorize resumption.

## Evidence Handling

Store detailed evidence in the agreed private channel. Public and repository
evidence may include commit/version, affected route category, severity,
redacted request shape, remediation PR, and retest result. It must not include
tokens, keys, raw vault payloads, email addresses, private destinations,
complete object IDs, or exploit-ready details before remediation.

Use `assessment-finding-template.md` for every finding. Create one Linear issue
per finding, apply severity and security labels, assign an owner and due date,
and link remediation and independent retest evidence. Chat summaries are not
the findings system of record.

## Cleanup And Readback

At the end of the window, revoke assessment credentials and delete only the
engagement's synthetic records. Read back:

- synthetic users, devices, refresh tokens, auth requests, vault rows, and
  attachment metadata;
- staging R2 test prefix;
- foreign-key violations;
- active test credentials and temporary allowlists;
- current Worker version and environment flags;
- unresolved findings and evidence custody owner.

Unexpected rows or objects block closeout. Preserve suspected incident evidence
before cleanup and follow `incident-response.md`.

## Preflight Checklist

- [ ] `HON-87` names the independent assessor.
- [ ] Owner and assessor signed the exact scope and authorization window.
- [ ] Exact commit, Worker version, staging targets, and source IP are pinned.
- [ ] Production and third-party targets are explicitly excluded.
- [ ] Synthetic account inventory and cleanup query are prepared.
- [ ] Rate/concurrency limits and stop contacts are confirmed.
- [ ] Private evidence channel and finding intake owner are ready.
- [ ] Incident response and credential revocation paths are rehearsed.

Until every item is checked, status remains `not authorized`.
