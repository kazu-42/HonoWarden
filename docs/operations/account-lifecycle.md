# Account Lifecycle Operator Runbook

HonoWarden account deletion is a recoverable, generation-bound state machine.
It is not a direct `users.disabled_at` toggle and it never uses
`DELETE FROM users` as a purge shortcut.

The public account-lifecycle routes and mailer integration are default-off.
Production deployment, real email delivery, real-account mutation, and purge
execution require separate approval and live evidence.

Before any later activation, the mailer must handle `deliver` and `suppress`
through the same bounded enqueue path, return exact `202` without waiting for a
provider, never deliver a suppressed request, and never log the JSON body or raw
token. Record a synthetic latency-envelope comparison for known and unknown
addresses; equal API status alone is not enumeration-resistance evidence.

## Safety Model

- `recoverable` rejects password grant, refresh grant, sync, and vault access
  while retaining encrypted data for 30 days.
- Recovery is allowed only for the exact lifecycle generation before its
  `recover_until` cutoff. Existing sessions remain revoked.
- `purge_ready` requires a reviewed post-cutoff plan and an exact attachment
  count. The plan and every later purge gate recheck that the disabled account
  has not become the last confirmed owner during the recovery window.
- `purging_r2` deletes personal R2 objects first. D1 attachment metadata stays
  intact after an R2 error so the same keys can be retried idempotently, and
  durable deletion progress cannot move backward when calls overlap.
- `tombstoned` removes personal rows and identity material but preserves
  organization ciphertext and an opaque user reference.
- No automatic transition performs irreversible deletion at the cutoff.

The `AccountLifecycleOperator` named WorkerEntrypoint exposes the mutation
methods through Cloudflare service-binding RPC. It has no public HTTP route.
Cloudflare documents that a named `WorkerEntrypoint` is reachable only by a
caller Worker with an explicit service binding and `entrypoint` selection.

## Read-Only Planning CLI

The CLI is dry-run by default and executes readback only. It replaced the old
direct `disable` / `enable` commands because those commands bypassed token,
session, audit, last-owner, and recovery-window invariants.

```sh
pnpm account:lifecycle -- \
  plan \
  --operation status \
  --user-id user-id-from-approved-ticket \
  --generation exact-lifecycle-generation \
  --database honowarden \
  --mode remote \
  --env production \
  --reason owner-request \
  --request-id HON-164-readback
```

The packet contains:

- a lifecycle-state and aggregate-count D1 readback command;
- a hash of the user/generation target;
- the private RPC entrypoint, method, and bounded input to hand to the approved
  operator Worker;
- explicit limitations showing that mutation execution is not included.

It does not print vault payloads, R2 object keys, token digests, authentication
hashes, wrapped keys, or encrypted item bodies. `--execute` is accepted only
for the read-only `status` operation and requires
`--confirm <lifecycle-generation>`.

## Private Operator Binding

The separately deployed operator Worker must bind to this Worker explicitly:

```json
{
  "services": [
    {
      "binding": "ACCOUNT_LIFECYCLE",
      "service": "honowarden",
      "entrypoint": "AccountLifecycleOperator"
    }
  ]
}
```

Do not add a public proxy route for this binding. The operator Worker owns
human authorization, operator identity, and the reviewed ticket correlation.
The HonoWarden entrypoint owns D1/R2 invariants and secret-safe audit rows.

Every RPC input includes:

- exact `userId`;
- exact `lifecycleGeneration`;
- bounded `requestId` and `reason`;
- for mutations, `confirmedLifecycleGeneration` equal to the target
  generation.

The planning CLI applies the same 128-character user/generation/request-ID and
256-character reason bounds as the private entrypoint, rejecting surrounding
whitespace and control characters before it emits a packet.

## Recovery

1. Generate a status plan and verify `state=recoverable`.
2. Verify the current time is strictly before `recover_until`.
3. Verify the user is not being recovered as a substitute for ownership
   transfer or incident response.
4. Through the approved operator Worker, call `plan` again and then `recover`
   with the exact confirmed generation.
5. Read back `state=recovered`, `users.disabled_at IS NULL`, a new security
   stamp, and the `account.deletion.recover` audit event.
6. Perform only the owner-approved login smoke. Old access and refresh tokens
   must remain invalid.

Recovery after the cutoff, recovery from `purge_ready`, and recovery from
`purging_r2` fail closed.

## Irreversible Purge

1. Generate a status plan after the cutoff.
2. Review personal cipher count, organization cipher count, and personal
   attachment count. The plan intentionally contains counts, not R2 keys.
3. Call `preparePurge` with the exact confirmed lifecycle generation. This
   rechecks last-owner safety, records `purge_ready` and the expected personal
   R2 count, but deletes nothing.
4. Obtain a separate irreversible-action approval.
5. Call `purge` through the private operator binding. Each call deletes at most
   1,000 personal R2 objects and returns durable deleted/remaining counts. While
   the result is `purging_r2`, repeat the same generation-confirmed call; obtain
   a fresh plan and stop if any count or state differs from the approved plan.
   R2 start and final D1 tombstoning each recheck last-owner safety so an
   ownership change after the original deletion request fails closed.
6. Read back all of the following:
   - `state=tombstoned`;
   - deleted R2 count equals the prepared count;
   - personal attachments, personal ciphers, and folders are absent;
   - organization ciphers and organization-scoped attachments remain;
   - the user and linked organization membership contain the same opaque
     tombstone email and no wrapped user/org key;
   - exactly one `account.deletion.purge` audit event exists.

If R2 deletion fails, do not manually delete D1 rows. The state remains
retryable, metadata stays present, and the same `purge` call reissues that
bounded idempotent object page. If D1 progress persistence fails after R2
success, retrying re-deletes the same already-absent page safely. If D1
finalization conflicts after the final R2 page, read the plan before retrying so
a response loss after a committed tombstone is not mistaken for an incomplete
purge.

## Rollback And Evidence

Recoverable deletion has a forward recovery path, not an inverse SQL command.
Purge has no rollback after tombstoning. Restore from a separately validated
backup is an incident procedure, not a normal lifecycle operation.

Record the source commit, exact lifecycle generation, plan packet, approval,
RPC method, redacted result, post-operation readback, and caller-visible smoke
in Linear. A successful source test or merged PR is not production execution
evidence.
