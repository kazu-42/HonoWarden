# Cloudflare release executor

`pnpm release:cf` is the reviewed source boundary for the staged Cloudflare
release. It does not establish live Cloudflare state, database restore, mail
delivery, or client acceptance by itself. Keep one operator as the **only
writer** for the target account and Worker. The per-target local `O_EXCL` lock
cannot fence another host or the dashboard.

The CLI accepts `--target staging` or `--target production`. Every command
requires `--credentials-file <private-credentials.env>`. Mutations require
`--execute --confirm <same-target>`; without them the CLI prints a plan and
performs no mutation. Production requires a separate fresh plan and literal
`--confirm production`. `deploy` and `staging:dry-run` remain STOP aliases.

## Credentials and account pin

The tracked `HONOWARDEN_ACCOUNT_SHA256` pin in
`scripts/honowarden-release.mjs` is filled for the reviewed account and is
shared by both targets. The all-zero `REPLACE_WITH_ACCOUNT_SHA256` sentinel
remains a refusal gate. For a different approved account, recompute the hash
locally with `python3 -c 'import getpass,hashlib; print(hashlib.sha256(getpass.getpass("Account ID: ").encode()).hexdigest())'`,
review the new 64-hex pin and both target identities, and replace the pin in
source. Keep the raw account ID out of the repository. Create a current-user-owned, mode 0600
dotenv file with **exactly** these two entries:

```dotenv
CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN=<scoped-user-api-token>
CLOUDFLARE_ACCOUNT_ID=<32-character-account-id>
```

The executor ignores ambient `CF_*` and `CLOUDFLARE_*`, checks the hash, and
requires `wrangler whoami --json` to report a User API Token with exactly one
visible account, equal to the pin. It never prints the token or raw account ID.
Wrangler's dotenv loading is redirected to an empty private file. Do not put
credentials on a command line or in a tracked dotenv file.

Each run owns a mode 0700 directory at
`${XDG_STATE_HOME:-$HOME/.local/state}/honowarden/release/<target>/<runId>/`.
The journal, temporary Wrangler output, built admin assets, and backup are
private. `backup.sql` can contain user data and wrapped secrets. Keep run
directories at 0700 and files at 0600; delete each run directory or move it
to the approved backup location after the release is accepted, retaining the
journal separately if required. Intent is journaled
and fsynced before each effect;
results and classifications follow it. The executor deletes raw Wrangler
machine output after extracting version IDs. It overwrites, fsyncs, and
unlinks run-local plaintext secret copies immediately after the Wrangler
upload or deploy call. Retain journals under the operator's private retention
policy. It never records secret values, vault data, or raw provider responses.

`generate-secrets` reads the serving version's secret **names** and writes a
new mode 0600 `{"target":"staging","secrets":{...}}` file containing only
missing allowlisted names. For an absent mailer, it first proves the Worker is
absent. It refuses to overwrite. `upload --secrets-file` checks that file's
target and permissions, then copies only its flat `secrets` map to a private
run file passed to Wrangler. Existing names require `--rotate <exact-name>`;
TOTP secret rotation is always refused here and requires the separate
[TOTP rewrap procedure](totp-secret-rotation.md). The new version must retain
exactly the predecessor secret names plus the added names. Do not assume a
bootstrap token must remain forever. Never paste secret contents into tickets.

## Staging sequence

Use one reviewed full 40-character commit SHA (`<sha>`) and one private
credentials path (`<creds>`) throughout. The source checks require a clean
checkout and exact `HEAD`. Substitute fresh observed version IDs. Every
command below includes the required credentials argument.

1. `pnpm release:cf plan --target staging --commit <sha> --credentials-file <creds>`.
   Review the worker, routes, service bindings, active 100% predecessor, and
   pending migration names. The migration read is a fixed read-only D1 query.
2. `pnpm release:cf ensure-queues --target staging --config wrangler.account-mailer.jsonc --credentials-file <creds> --execute --confirm staging`.
   Create only missing queues, set retention to 86,400 seconds on the main
   queue and DLQ, and read back both. An ambiguous create/update stops.
3. Before the account mailer first deploy, run
   `pnpm release:cf generate-secrets --target staging --config wrangler.account-mailer.jsonc --out <private-account-mail-json> --credentials-file <creds> --execute --confirm staging`
   if the key is absent. Pass it as `--secrets-file <private-account-mail-json>`;
   the account mailer refuses to serve without
   `HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS`. Invitation mailer accepts no secrets.
   Release each mailer from its tracked config. For an absent Worker, use
   `first-deploy --target staging --config <mailer-config> --commit <sha> --credentials-file <creds> --execute --confirm staging` only after the absence read. This immediately serves the private mailer. For an existing mailer, use
   `upload --target staging --config <mailer-config> --commit <sha> --expect-active <old-id> --credentials-file <creds> --execute --confirm staging`, then
   `activate --target staging --config <mailer-config> --commit <sha> --version <new-id> --expect-active <old-id> --expect-initial-setup off --credentials-file <creds> --execute --confirm staging`, then
   `verify --target staging --config <mailer-config> --commit <sha> --version <new-id> --expect-initial-setup off --credentials-file <creds>`.
   Existing account mailers retain their key; provide a secrets file only when
   a required key is missing. A missing config fails before a remote call.
4. `pnpm release:cf backup-db --target staging --commit <sha> --credentials-file <creds> --execute --confirm staging` records a Time Travel bookmark and D1 SQL export with size and SHA-256. Prove restore separately. Migration requires a successful backup for the same target and commit within two hours, with both bookmark and verified export hash.
5. `pnpm release:cf migrate-db --target staging --commit <sha> --expect-pending <exact-comma-separated-filenames> --credentials-file <creds> --execute --confirm staging` compares the fresh pending list byte for byte, checks the tracked SHA-256 manifest of all 35 migration files and the live 62-object 0014 schema baseline, applies once, and requires zero pending. On partial failure, inspect the applied subset and bookmark; choose restore or forward repair manually. It checks both migration ledgers (35 rows, max `0033`), 41 tables, 61 indexes, 6 triggers, every reviewed `sqlite_master` object SQL hash, and `PRAGMA foreign_key_check`. A post-apply mismatch journals table/index structural and normalized trigger comparisons. Wrangler 4.112.0 does not expose stable per-file executed statement counts; the 113 expected statements are not a live assertion.
6. `pnpm release:cf verify-db --target staging --commit <sha> --expect-pending "" --credentials-file <creds>` independently repeats the complete read-only schema check. Rejected `PRAGMA foreign_key_check` is a failure.
7. `pnpm release:cf generate-secrets --target staging --out <private-vault-json> --credentials-file <creds> --execute --confirm staging` generates only absent vault secrets. Preserve existing token-signing and TOTP secrets. Use the bootstrap token privately for the first account only if one is newly needed.
8. `pnpm release:cf upload --target staging --commit <sha> --expect-active <old-id> --profile deploy/profiles/staging-company-launch.json --initial-setup-window --secrets-file <private-vault-json> --credentials-file <creds> --execute --confirm staging` builds admin assets from the verified checkout inside the private run directory. The Wrangler dry run hashes the main module; upload tags the exact commit, uses `--strict`, and stays non-serving. The executor reads back exact vars, bindings, secret names, module bytes, version list, and traffic. Omit `--secrets-file` if no vault secrets are missing.
9. `pnpm release:cf activate --target staging --commit <sha> --profile deploy/profiles/staging-company-launch.json --version <setup-id> --expect-active <old-id> --expect-initial-setup on --credentials-file <creds> --execute --confirm staging` rechecks the candidate and selects one exact version at 100%. It then reads back traffic and non-versioned settings. Never split traffic between authorization versions.
10. `pnpm release:cf verify --target staging --commit <sha> --profile deploy/profiles/staging-company-launch.json --version <setup-id> --expect-initial-setup on --credentials-file <creds>` checks health provenance, exact admin file byte hashes and security headers over HTTPS, and secret names. Create the first account through the dashboard while this window is open.
11. Upload a second version without `--initial-setup-window`:
    `pnpm release:cf upload --target staging --commit <sha> --expect-active <setup-id> --profile deploy/profiles/staging-company-launch.json --credentials-file <creds> --execute --confirm staging`.
    Activate it with
    `pnpm release:cf activate --target staging --commit <sha> --profile deploy/profiles/staging-company-launch.json --version <closed-id> --expect-active <setup-id> --expect-initial-setup off --credentials-file <creds> --execute --confirm staging`,
    then run
    `pnpm release:cf verify --target staging --commit <sha> --profile deploy/profiles/staging-company-launch.json --version <closed-id> --expect-initial-setup off --credentials-file <creds>`.
    Require `initialSetupEnabled: false`.
12. `pnpm release:cf verify-db --target staging --commit <sha> --expect-pending "" --post-deploy --credentials-file <creds>` checks that no users have `NULL email_verified_at` and no enabled verified TOTP rows have `NULL credential_generation`, through the sealed read-only DB path. Continue with browser, mail, official-client and native Windows/macOS acceptance from the review packet.

For production, start a **new** plan and backup on production using the **same
full commit SHA as staging's migration**. Use production's own predecessor,
its own secret-name readback, the separately targeted
`--profile deploy/profiles/production-company-launch.json`, and
`--confirm production`. Review the production profile's writer flags separately
before use. Production vault upload
also requires `--expect-module-sha256 <staging-accepted-main-module-sha256> --expect-admin-manifest <staging-run-journal.jsonl>`;
the dry-run module and freshly built admin file hashes must match before any
upload. Production mailer `upload` and `first-deploy` each require
`--expect-module-sha256 <staging-accepted-mailer-module-sha256>`.
Repeat schema, activation, verify and
acceptance checks on production. Worker rollback does not revert D1 schema,
delivered mail, R2 objects or setup receipts. `activate` is only an explicit
recovery path to a separately reviewed compatible version.

The non-versioned settings readback includes the vault's existing Durable
Object migration tag `v1` for `NotificationHub`; the executor never replays
that creation. Wrangler 4.112.0 normalizes an omitted observability
`head_sampling_rate` to its documented default `1`. The executor accepts that
omission only when the reviewed config also requests `1`; other omissions
are classified as unverified.

## Failure and recovery

| Observation                                                             | Operator action                                                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account pin, source, config, migration manifest or predecessor mismatch | Stop, reconcile identity and reviewed source, obtain a fresh plan.                                                                                                    |
| Backup missing or stale                                                 | Create a fresh backup from the same clean commit; verify export and bookmark before migration.                                                                        |
| Upload failed, ID absent, or version multiplicity                       | Read exact version history and traffic; Wrangler may retry the POST internally. Do not retry or activate an assumed candidate.                                        |
| `--strict` rejects remote drift                                         | Inspect drift, obtain a fresh plan, and start a new reviewed run. Never retry without `--strict`.                                                                     |
| Uploaded version differs in bytes, bindings, secrets or tag             | Leave it non-serving and start a new reviewed candidate.                                                                                                              |
| Activation failed or timed out                                          | Use `candidate_active`, `previous_active`, `unknown`, or `serving_unverified` in the journal; read traffic, settings and health independently before another command. |
| Migration partially applied                                             | Use the journal's applied subset and bookmark; decide forward repair or Time Travel restore with current-write impact assessed.                                       |
| Mailer first deploy or queue create ambiguous                           | Read exact Worker/queue presence and serving state before any retry.                                                                                                  |
| Local `.lock` remains after a crash                                     | Check prior process and child Wrangler have stopped; preserve its journal, then remove only that target's stale lock.                                                 |

## Scoped token permissions

These are permission **categories inferred from locally installed Wrangler
4.112.0** and `cloudflare-access-control.md`. Cloudflare's exact permission
template and whether `whoami --json` needs User Details scope are **to verify**
with a scoped token before live use.

| Command                              | Expected account permission categories                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `plan`, `verify`, `generate-secrets` | Workers Scripts Read; D1 Read for vault plan; account identity read for `whoami` (to verify)     |
| `verify-db`                          | D1 Read for ledger, schema, FK and post-deploy queries                                           |
| `backup-db`                          | D1 Read / export and Time Travel bookmark read (exact split to verify)                           |
| `migrate-db`                         | D1 Write, plus D1 Read for list and bookmark                                                     |
| `upload`, `activate`                 | Workers Scripts Write and Read; assets upload may need Workers R2 Storage Write (to verify)      |
| `ensure-queues`                      | Queues Read and Write                                                                            |
| `first-deploy`                       | Workers Scripts Write and Read; non-versioned settings read; route/trigger permissions to verify |

Wrangler 4.112.0 accepts `--secrets-file` on both `versions upload` and
`deploy`. Wrangler's single-secret put command immediately creates a serving
version and is outside this executor. The `versions upload --assets <dir>` option overrides
only `assets.directory` in Wrangler's resolved config; binding,
`run_worker_first`, `not_found_handling`, and `html_handling` remain from the
tracked config. The executor hashes the built admin files and refuses a
different served byte stream.
