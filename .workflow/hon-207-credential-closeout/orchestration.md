# HON-207 Orchestration

## Execution Order

```text
CLIENT-1 -> CLIENT-2 -> RECOVERY-1 -> EVIDENCE-1 -> CLOSE-1
```

Only one packet is active at a time. A packet advances after focused tests,
artifact readback, secret scan, and predecessor completion.

## Packet Ownership

### CLIENT-1

Owns official source and release provenance, ignored asset/cache layout,
deterministic crypto bridge, unmodified CLI runner, isolated profile contract,
redaction, process cleanup, and unit tests.

It must not add a product route or compatibility promotion.

### CLIENT-2

Owns the one-account credential sequence, real local Wrangler/D1/R2 topology,
official-client login/unlock/sync/decrypt checks, generation manifest, old
credential/session/profile rejection, and restart evidence.

It may compose merged HON-203 through HON-206 routes. It must not weaken their
individual transactional or default-off invariants.

### RECOVERY-1

Owns exact post-generation backup export, manifest/digest validation,
fresh-target restore, stale-generation rejection, enabled/disabled Worker
state equality, forward recovery, and R2 byte preservation.

It must fail loudly if the restore source does not match the approved
post-generation manifest.

### EVIDENCE-1

Owns compatibility evidence levels, client matrix changes, current-state and
security documentation, audit/retention and backup/restore reconciliation,
operator recovery instructions, release indexes, and secret scans.

It must distinguish official-client crypto, official CLI public commands,
API-only route evidence, local runtime, staging, and production.

### CLOSE-1

Owns all repository gates, exact-head reviews, remediation, PR publication,
head CI, admin squash merge, tree equality, merged-main CI, Linear comments,
Done/archive operations, HON-160 closeout, and isolated cleanup.

## Integration Invariants

- HonoWarden source remains the only product implementation under review.
- Downloaded official assets and generated client profiles remain ignored.
- The generation manifest contains only labels, version pins, statuses, counts,
  and digests. It contains no password, raw token, wrapped/unwrapped key,
  encrypted item body, personal identity, provider payload, or profile data.
- All four credential writers remain default-off in tracked environments.
- The lifecycle enables writers only on isolated local Workers.
- Old-generation rejection is tested after each owning commit and after
  Worker/client restart.
- A restored target must use the exact approved final backup and must reject
  all pre-final credentials and sessions.
- Browser automation uses Chrome for Testing only and cannot attach to the
  normal Brave profile or incognito windows.

## Review Gates

1. Standard review checks bugs, security boundaries, data loss, D1 atomicity,
   official-client claim accuracy, secret leakage, cleanup, and tests.
2. Independent five-axis review checks intent/contract, correctness/security,
   architecture/transactions, repository consistency, and
   regression/operations/evidence.
3. Any actionable P1/P2/P3 is reproduced with a focused failing test before
   remediation.
4. Merge requires the reviewed exact head, green head CI, zero unresolved
   threads, and no source changes after the final verdict.

## Operational Boundaries

- Local synthetic client assets may be downloaded from official GitHub release
  endpoints.
- Production activation, remote databases/buckets, real accounts/secrets,
  credential rotation, destructive operations, paid actions, and external
  contact remain excluded.
- Runtime rollback never restores an older credential generation. Recovery is
  forward-only.
