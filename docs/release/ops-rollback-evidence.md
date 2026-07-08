# Operations Rollback Evidence

Target: `v0.1.0-alpha`.

Status: partial.

Mode: post-alpha rollback handle and recovery evidence.

This file records rollback readiness after Worker deploy, website route changes,
or Email Routing changes. It remains `partial` until website and Email Routing
rollback evidence is recorded and a rollback rehearsal or actual rollback has
been verified.

Rollback readiness is separate from release publication, CI success, and local
dry-run output.

## API Worker Previous-Version Handles

Standing operator approval was provided on 2026-07-08. API Worker deploys were
completed after the alpha GitHub Release was published and verified.

### Staging API Worker

- Current version: `bf0333dc-9efa-4001-aa31-20b3e10731c9`
- Current deployment: `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`
- Candidate previous version: `f2357f14-8430-4b9f-913d-2dbad72322dd`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved rollback command: unresolved

### Production API Worker

- Current version: `72577dd9-c859-4673-b653-fbdd796f8f7d`
- Current deployment: `24f81b98-b761-4faa-aa78-cd773bb5d0c1`
- Candidate previous version: `2c0b365b-3cf9-4766-ba8d-e5bd969c969d`
- Candidate status: pre-correction `main` deployment, not verified as the safe
  rollback target
- Approved rollback command: unresolved

The candidate previous versions are known deployable Worker versions, but they
are the pre-correction deployments from `main`
`392637b3e277ba35057ba461cd82fac69013f603`, not the alpha release target. Do
not treat them as approved rollback targets without an incident-specific
decision. Rollback was not executed because post-deploy smoke passed.

## Evidence To Record

For each approved operation, record:

- approval text and timestamp
- operation owner
- environment
- commit SHA or configuration version before the operation
- commit SHA or configuration version after the operation
- previous Worker deployment id or route target
- previous website deployment id or route target
- previous DNS record state, if DNS changed
- previous Email Routing rule state, if email changed
- exact rollback command or Cloudflare dashboard path
- health checks after rollback rehearsal or actual rollback
- decision to continue, rollback, or hold

Do not record secret values, private forwarding destinations, or real vault
data.

## Rollback Commands To Fill In

API Worker:

```sh
# API Worker rollback command is unresolved.
# Candidate previous versions for investigation:
# staging: f2357f14-8430-4b9f-913d-2dbad72322dd
# production: 2c0b365b-3cf9-4766-ba8d-e5bd969c969d
#
# Do not run a rollback until the operator selects a verified safe target or
# decides to redeploy a reviewed commit.
```

Website:

```sh
# Fill in the approved previous website deployment id or route restore command.
```

Email Routing:

```sh
# Fill in the approved route disable or provider rollback step.
```

## Not Performed

- API Worker rollback command approval has not been recorded.
- API Worker rollback rehearsal has not been performed by this evidence file.
- Website route rollback has not been performed by this evidence file.
- Email Routing rollback has not been performed by this evidence file.
- DNS rollback has not been performed by this evidence file.

## Completion Criteria

This evidence can be marked `passed` only after:

1. The relevant operation has approval.
2. The previous safe state is identified.
3. A concrete rollback command or dashboard path is recorded.
4. Post-rollback health or route checks are recorded.
5. No secrets or private message content are included.
