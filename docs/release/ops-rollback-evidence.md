# Operations Rollback Evidence

Target: `v0.1.0-alpha`.

Status: not_performed.

Mode: post-alpha rollback handle and recovery evidence.

This file is the required evidence placeholder for rollback readiness after
Worker deploy, website route changes, or Email Routing changes. It must remain
`not_performed` until the operator has recorded concrete rollback handles and
verified that the service can return to the previous safe state.

Rollback readiness is separate from release publication, CI success, and local
dry-run output.

## Required Approval Before Execution

Rollback evidence collection must explicitly name the operation being guarded:

- API Worker deploy
- website deploy or domain route change
- DNS change
- Email Routing change
- production secret write

If the operation has not been approved, record the rollback plan only and leave
this file as `not_performed`.

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
# Fill in the approved previous deployment id or redeploy command.
pnpm wrangler deploy --env staging
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

- Rollback rehearsal has not been performed by this evidence file.
- API Worker rollback has not been performed by this evidence file.
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
