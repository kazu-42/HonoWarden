# Rollback Guide

Target: `v0.1.0-alpha`.

Last updated: 2026-08-09.

Rollback separates Worker code rollback from data rollback. Do not assume schema
changes can be safely reversed in place.

## Decide Rollback Type

| Failure                                     | Preferred Action                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Worker deploy failed before serving traffic | preserve evidence; request a reviewed recovery protocol                  |
| Worker serving errors with unchanged schema | isolate writes; request a reviewed known-good source recovery            |
| migration applied and new code is bad       | keep data target isolated, deploy compatible fix or restore fresh target |
| backup restore failed                       | discard restore target and rerun from the same backup                    |
| secrets exposed                             | rotate affected secrets and invalidate sessions where applicable         |

## Credential Writer Rollback Boundary

Credential rollback evidence is reconciled in the canonical
[closeout packet](../../compat/credential-closeout-packet.json) and
[evidence registry](../../compat/credential-evidence.json). The evidence covers
local API and local official-client readback only. It does not prove staging or
production writer activation.

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

The tracked writer flags remain disabled at every configured scope:

| Flag                                   | Top-level | Staging | Production |
| -------------------------------------- | --------- | ------- | ---------- |
| `HONOWARDEN_PASSWORD_CHANGE_ENABLED`   | `false`   | `false` | `false`    |
| `HONOWARDEN_ACCOUNT_KEYS_ENABLED`      | `false`   | `false` | `false`    |
| `HONOWARDEN_KDF_MUTATION_ENABLED`      | `false`   | `false` | `false`    |
| `HONOWARDEN_USER_KEY_ROTATION_ENABLED` | `false`   | `false` | `false`    |

Disabling these writers is a forward-only route stop for new credential
mutations. It is not a historical restore mechanism: it does not undo a
committed password, KDF, account-key, user-key, backup, restore, or forward
generation, and it must not be used to resurrect old hashes, wrapped keys,
sessions, or encrypted payload generations.

## Worker Code Rollback

Status: **REAL WORKER/VERSION/TRAFFIC WRITE STOP**. This repository has no
executable Worker rollback, deploy dry-run, version activation, or automated
traffic recovery path. Direct Wrangler use is not an approved fallback.

Prepare a recovery candidate locally without remote authority:

```sh
git worktree add --detach <dedicated-rollback-path> <previous-good-full-commit>
cd <dedicated-rollback-path>
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
```

A future reviewed recovery protocol must verify `/health`, `/healthz`,
`/health/db`, `/api/config`, and authorized synthetic login/sync on the same
observed deployment. Both health aliases must report the intended `environment`,
a distinct `workerVersionId`, a valid `createdAt`, and the rollback commit in
`build.gitSha`; `/api/config.gitHash` must equal the same SHA. It must capture
traffic and every non-versioned setting, classify partial success, and prove
recovery independently without overwriting unexpected remote state.

## Password Change Rollback

Deploy complete password-generation readers with
`HONOWARDEN_PASSWORD_CHANGE_ENABLED=false` and preserve that exact release as
the reader-capable rollback target before exposing the writer. Disabling the
flag is the immediate route rollback and must happen before authentication,
quota, or D1 access; it does not undo a generation that already committed.

After a password change commits, the prior hash, wrapped user key, access
tokens, refresh tokens, devices, and auth requests are stale. Never restore
those values in place. Reauthenticate with the current generation and roll
forward, or use a separately reviewed recovery procedure. Keep migration
`0016_user_key_rotation_wrapper_history.sql` because deleting its fingerprints
would remove replay defense for later credential writes.

## KDF Mutation Rollback

Deploy KDF reader support with `HONOWARDEN_KDF_MUTATION_ENABLED=false` before
any environment exposes the writer. Preserve that deployment as the
reader-capable rollback target, then activate the writer only in a later Worker
version. Disabling the flag stops new KDF changes without changing existing
credential state.

Migration `0014a` is forward-only. Keep `account_kdf_population` and its user
triggers in place during a Worker rollback; older code can ignore them, while
the triggers continue to preserve counts for a subsequent reader-capable roll
forward. Do not drop or rebuild the table in place during incident response.

Once any account has committed Argon2id, do not roll back to a pre-reader
release. Such a release projects the stored generation as PBKDF2, causing the
client to derive the wrong authentication hash. Roll back to the recorded
reader-capable version or roll forward with a compatible fix. Never restore an
old password hash, wrapped user key, security stamp, or KDF generation because
that can resurrect revoked sessions.

## Account Key Initialization Rollback

Deploy complete account-key readers with
`HONOWARDEN_ACCOUNT_KEYS_ENABLED=false` before exposing the dedicated routes.
Enabling the flag activates both authenticated GET and one-time V1 POST;
disabling it is the immediate route rollback and must not delete or null an
already initialized pair.

The initializer cannot replace data, but the current writer depends on retained
migration `0016_user_key_rotation_wrapper_history.sql` to reject cross-role
wrapper replay and atomically record the initial wrapper generation. Apply
`0016` before this Worker and do not remove its table during rollback. After any
account initializes, roll back only to a version whose token, profile, sync,
and backup projections understand a complete pair, reject partial state, and
preserve wrapper-history enforcement. A pre-reader or pre-history writer may
silently omit account-key fields or accept a recorded wrapper and is not an
acceptable rollback target.

If initialization returns 503, read back the account row and required audit
event before deciding whether to retry. A failed D1 batch leaves both columns
null and no `account.keys.initialize` row; retry is safe after infrastructure
recovery. The local lifecycle proves both audit-insert failure before update and
user-update failure after audit reservation roll the complete batch back. A
complete exact pair plus one audit means the generation committed and must be
treated as success. A missing or blank wrapped user key is rejected before the
batch and must be repaired through a separately reviewed account-recovery path.
A partial or different pair is an incident boundary: disable the route,
preserve the row and logs, and use a separately reviewed recovery plan. Never
use HON-205 POST as replacement or data-rewrap.

## User-Key Rotation Rollback

Deploy the complete post-rotation readers with
`HONOWARDEN_USER_KEY_ROTATION_ENABLED=false` and preserve that exact release as
the reader-capable rollback target. Enabling the flag starts new writes;
disabling it is the immediate route rollback and does not alter any generation
that already committed.

The client and D1 move as one generation, but a response can still be lost after
commit. Before retrying a 503 or disconnected request, read the account security
stamp/revision and the required `account.keys.rotate` audit row. If the new
generation exists, treat the server write as committed and complete recovery by
reauthenticating with that generation. If it does not exist, the transactional
batch rolled back and a fresh authenticated retry may proceed after the
infrastructure failure is fixed.

Migration `0016` is forward-only. Keep
`user_key_rotation_wrapper_history` in place during Worker rollback; older
reader-capable code can ignore it, while deleting it would remove the durable
replay-defense boundary for a later roll-forward. Disable
`HONOWARDEN_PASSWORD_CHANGE_ENABLED`, `HONOWARDEN_ACCOUNT_KEYS_ENABLED`,
`HONOWARDEN_KDF_MUTATION_ENABLED`, and
`HONOWARDEN_USER_KEY_ROTATION_ENABLED`, drain in-flight credential requests,
and wait for active requests to finish; do
not deploy a pre-reader Worker after any post-`0016` credential mutation.
History is forward-looking; wrappers
superseded before `0016` were never recorded and cannot be treated as
replay-protected.

Never restore an old password hash, wrapped user key, wrapped private key,
security stamp, encrypted vault snapshot, device session, or refresh token.
That can combine incompatible ciphertext generations or resurrect revoked
sessions. Recovery from a committed but unusable generation requires a
separately authenticated forward generation or a separately reviewed account-
recovery procedure. Keep R2 object keys and bytes untouched; this flow changes
only their D1 encrypted metadata.

## Account Lifecycle Rollback

Migration `0017` is forward-only. Keep `email_verified_at`,
`account_lifecycle_tokens`, and `account_deletions` in place during Worker
rollback. Deploy a complete lifecycle reader and private operator surface with
`HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED=false`; disabling the public routes stops
new requests but does not recover an account, cancel an accepted email change,
or finish an in-progress purge.

An email change that committed is a credential generation: the old email,
password hash, wrapped key, security stamp, devices, refresh tokens, and auth
requests must not be restored independently. Reauthenticate with the committed
generation and roll forward.

For a `recoverable` deletion, use the private named
`AccountLifecycleOperator.recover` operation before `recover_until`. Recovery
must atomically return the account to active state with a new security stamp;
old sessions remain revoked. Do not use a direct `users.status` edit or the
retired account disable/enable CLI path because it bypasses the lifecycle
generation and audit invariants.

After the recovery cutoff, or once state is `purge_ready`, `purging_r2`, or
`tombstoned`, recovery is forbidden. Preserve the D1 row and R2 error metadata,
then retry the same private purge operation. R2 deletion is idempotent and
bounded; D1 finalization is allowed only after the recorded personal-object
count is complete. Organization ciphers, organization attachments, and the
user tombstone are preservation boundaries and must not be restored or deleted
by an incident shortcut. A failed purge is a roll-forward incident, not a
reason to restore a partially deleted backup over the source environment.

Rotating `HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET` invalidates outstanding email
and deletion tokens. First set the feature flag false, allow in-flight requests
to drain, record the affected token window, rotate the secret, and issue new
tokens only after the complete reader/operator deployment is verified. Mailer
outage rollback is limited to disabling new public requests and retrying token
delivery with a new token; provider responses and raw tokens must never be
copied into incident evidence.

## WebAuthn Persistence Rollback

Migration `0015` is forward-only. Keep `webauthn_credentials` and
`webauthn_challenges` during Worker rollback. HON-209 does not mount WebAuthn
routes or enable `HONOWARDEN_WEBAUTHN_ENABLED`, so the normal rollback is to
leave the additive tables in place while tracked configuration stays
default-off.

Rollback never un-consumes a challenge, restores a deleted credential, rolls a
sign counter backward, or down-migrates authenticator state. Failed
verification must continue to write nothing. After a later activation, first
set enablement false, read back route absence, and preserve D1 state for
review.

## Encrypted Text Send Foundation Rollback

Migration `0020` is forward-only. Keep the `personal_api_keys` table during
Worker rollback. HON-161 does not enable personal API keys at tracked scopes,
so the normal rollback is to a Worker that ignores the additive table while
`HONOWARDEN_PERSONAL_API_KEYS_ENABLED` remains false.

Migration `0018` is forward-only. Keep the `sends` table and its indexes during
Worker rollback. HON-184 does not mount Send routes, enable `send-enabled`,
write runtime secrets, or create remote rows, so the normal rollback is to a
Worker that ignores the additive table while the existing `501` guards remain
in force.

## Encrypted File Send Foundation Rollback

Migration `0019` is forward-only. Keep the `send_files` and
`send_download_tickets` tables during Worker rollback. HON-185 does not mount
Send routes, enable `send-enabled`, expose R2, or create remote objects, so the
normal rollback is to a Worker that ignores the additive tables while the
existing `501` guards remain in force. Never prefix-delete R2 objects and never
clean a generation unless the D1 tombstone still names that exact object key.

After a later Send activation, never roll back to code that cannot read the
stored capability-envelope and verifier key versions. First disable Send at
the kill gate, drain owner and public requests, preserve D1 tombstones and
access generations, and use a separately reviewed protocol for a
reader-capable Worker. Do not copy a raw
capability or client password input into D1 or incident evidence, do not replace
an envelope with a verifier, and do not decrement an access generation to
restore a prior link. If an envelope or lookup root is exposed, follow ADR 0011
containment and roll forward with independent keyring rotation and surviving-
Send capability regeneration.

## Data Rollback

There are no down migrations for alpha. Use fresh-target restore:

1. Stop writes to the affected environment if possible.
2. Create fresh D1 and R2 targets.
3. Restore the last known-good backup with `--confirm-fresh-target`.
4. Point Worker configuration to the restored targets.
5. Use a separately reviewed protocol for Worker code compatible with the
   restored schema.
6. Verify health and synthetic sync.

Do not restore over the original source database during alpha.

## Secret Exposure Rollback

If a secret is exposed:

- access-token signing key: restore the last known-good access-token keyring or
  remove the compromised `kid` from the verifier set, then verify that tokens
  for that `kid` fail while unaffected tokens follow the approved rotation
  window.
- `HONOWARDEN_TOKEN_SECRET`: rotate and force re-login; existing refresh-token
  hash lookups and legacy no-kid access-token fallback will fail after
  rotation.
- `HONOWARDEN_TOTP_SECRET`: rotate only with a TOTP re-enrollment plan; existing
  encrypted setup secrets cannot be decrypted by the new secret.
- `HONOWARDEN_BOOTSTRAP_TOKEN`: rotate immediately and keep bootstrap disabled.
- `HONOWARDEN_AUTH_REQUEST_SECRET`: first set
  `HONOWARDEN_AUTH_REQUESTS_ENABLED=false`. Allow the 15-minute active window
  to drain before rotation; rotating immediately invalidates every pending or
  approved unconsumed request. Do not reopen consumed rows during rollback.

Use [Access Token Key Rotation](../operations/access-token-key-rotation.md) for
staged access-token signing-key rollback. Do not treat access-token keyring
rollback as a complete `HONOWARDEN_TOKEN_SECRET` rotation drill.

## Evidence To Record

- incident start time and detection source
- affected commit and deploy command
- previous known-good commit
- CI run URLs
- migration versions before and after rollback
- backup manifest path if restore is used
- secret rotation actions
- final health and synthetic sync results
