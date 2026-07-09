# Account Lifecycle Operator Runbook

HonoWarden represents account disablement in D1 with `users.disabled_at`.
Runtime auth, refresh, sync, and vault CRUD paths already reject disabled users
through the active-user guards. This runbook covers the operator CLI that plans
or applies that lifecycle flag without exposing a public admin API.

The wrapper is dry-run by default:

```sh
pnpm account:lifecycle -- \
  disable \
  --email owner@example.test \
  --database honowarden \
  --mode remote \
  --env production \
  --reason owner-request-20260709
```

Dry-run output is a JSON packet with:

- the pre-operation D1 readback command
- the guarded mutation command
- the post-operation D1 readback command
- the inverse rollback command
- an audit block with action, reason, generated timestamp, and target hash

The packet does not print vault payloads, encrypted item bodies, password
hashes, token hashes, private keys, or decrypted values. It does include the
operator-selected account selector in the SQL command, so treat packets as
sensitive operational metadata.

## Disable An Account

Plan by normalized email:

```sh
pnpm account:lifecycle -- \
  disable \
  --email owner@example.test \
  --database honowarden \
  --mode remote \
  --env production \
  --reason owner-request-20260709
```

Execute only after reviewing the packet and confirming the target:

```sh
pnpm account:lifecycle -- \
  disable \
  --email owner@example.test \
  --database honowarden \
  --mode remote \
  --env production \
  --reason owner-request-20260709 \
  --execute \
  --confirm owner@example.test
```

`--confirm <target>` must exactly match the normalized email or user id. The
disable mutation updates `disabled_at`, `updated_at`, and `revision_date` only
when `disabled_at IS NULL`.

## Enable An Account

Plan by user id when an email address is ambiguous in incident notes or should
not be reprinted:

```sh
pnpm account:lifecycle -- \
  enable \
  --user-id user-id-from-approved-ticket \
  --database honowarden \
  --mode remote \
  --env production \
  --reason restore-approved-access
```

Execute after owner approval and target confirmation:

```sh
pnpm account:lifecycle -- \
  enable \
  --user-id user-id-from-approved-ticket \
  --database honowarden \
  --mode remote \
  --env production \
  --reason restore-approved-access \
  --execute \
  --confirm user-id-from-approved-ticket
```

The enable mutation clears `disabled_at` and updates account revision metadata
only when `disabled_at IS NOT NULL`.

## Verification

For a disable operation, verify:

- pre-operation readback shows exactly one matched active account
- mutation completes without errors
- post-operation readback shows exactly one matched disabled account
- password grant returns the generic invalid-grant response
- refresh grant fails before rotation
- sync and vault CRUD reject the disabled user
- no real vault data appears in the packet or recorded evidence

For an enable operation, verify:

- pre-operation readback shows exactly one matched disabled account
- mutation completes without errors
- post-operation readback shows exactly one matched active account
- the owner-approved client smoke can authenticate again with synthetic or
  approved test data

The existing automated test suite covers disabled-user behavior for password
grant, refresh grant, sync, and vault owner-scoped data access. In short,
password grant, refresh grant, sync, and vault CRUD must all reject disabled
users. Production evidence still needs an operator-owned live lifecycle record
before non-operator accounts are invited.

## Rollback And Recovery

Each packet prints the inverse `rollbackCommand`.

- If a disable was applied to the wrong account, run the printed enable command
  only after owner approval and incident lead confirmation.
- If an enable was applied incorrectly, run the printed disable command and
  invalidate active sessions through the existing device/session revoke routes
  when appropriate.
- Record the packet, reason, command output, post-operation readback counts,
  source commit, operator approval, and recovery action in Linear.

Do not edit vault rows, refresh-token hashes, device rows, or encrypted payload
columns to perform account lifecycle operations.
