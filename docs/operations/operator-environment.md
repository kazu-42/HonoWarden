# Operator Environment

This document defines the local operator environment for HonoWarden automation.
It keeps project URLs and non-secret defaults in git while keeping API keys,
Cloudflare tokens, destination inboxes, and runtime secrets outside git.

Cloudflare account access-control evidence and the least-privilege token plan
are recorded in
[Cloudflare Access-Control Review](cloudflare-access-control.md).

## Scope

Use this environment for local automation only:

- validating the Linear seed
- verifying Linear API access before applying the seed
- applying Linear issues/projects/views once the workspace is accessible
- creating or updating the separate website repository
- deploying Workers after explicit approval
- configuring Cloudflare DNS and email routing after explicit approval

Do not use this file as a production secret source. Worker runtime secrets must
be set through Wrangler secrets for each environment.

## direnv Setup

Install and hook direnv once on the machine:

```sh
brew install direnv
```

Add the shell hook if it is not already configured:

```sh
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
```

Then enable this repository:

```sh
cp .env.example .env.local
$EDITOR .env.local
direnv allow
```

Tracked `.envrc` contains only non-secret defaults:

- `HONOWARDEN_DOMAIN=honowarden.com`
- `HONOWARDEN_REPOSITORY_URL=https://github.com/kazu-42/HonoWarden`
- `HONOWARDEN_WEBSITE_REPOSITORY_NAME=HonoWarden-website`
- `HONOWARDEN_WEBSITE_REPOSITORY_URL=https://github.com/kazu-42/HonoWarden-website`
- `HONOWARDEN_LINEAR_URL=https://linear.app/honowarden/`
- `HONOWARDEN_LINEAR_WORKSPACE_SLUG=honowarden`
- `HONOWARDEN_CLOUDFLARE_ZONE_NAME=honowarden.com`

Ignored local files may provide secrets:

- `.env.local`
- `.envrc.local`

Use `.env.local` for dotenv-style `KEY=value` entries copied from
`.env.example`. Use `.envrc.local` only when shell syntax is needed. The
tracked `.envrc` watches both ignored local files, loads `.env.local` with
`dotenv_if_exists`, and loads `.envrc.local` with `source_env_if_exists`.
Changing local API keys or forwarding destinations prompts direnv to reload
after the next `direnv allow`.

The Cloudflare global API key is a break-glass credential, not an automation
fallback. If it is retained for scoped-token remediation or a rotation drill,
keep it in a home-directory secret file instead of the repository checkout:

```sh
mkdir -p ~/.config/honowarden
chmod 700 ~/.config/honowarden
$EDITOR ~/.config/honowarden/cloudflare.env
chmod 600 ~/.config/honowarden/cloudflare.env
```

Do not source this break-glass file from the repository's `.envrc.local` or any
routine shell. Load it only inside the isolated, explicitly approved remediation
or rotation window, then exit that shell.

The two legitimate global-key carve-outs are
`scripts/honowarden-cloudflare-token-remediation.mjs`, whose job is to mint the
scoped tokens, and `scripts/honowarden-secret-rotation-drill.mjs`, whose job is
to inventory the break-glass rotation plan. The email preflight inspects only
whether a global-key variable is present so it can reject that auth path with a
structural reason; it never accepts the key. Do not commit the home env file,
`.envrc.local`, or any rendered Cloudflare key value.

Scoped HonoWarden Cloudflare account tokens are generated and verified with:

```sh
pnpm cloudflare:tokens -- plan
pnpm cloudflare:tokens -- apply --auth global
pnpm cloudflare:tokens -- apply --auth global --execute
pnpm cloudflare:tokens -- verify
```

`apply` without `--execute` performs live permission/readback planning only.
`apply --execute` creates missing scoped account tokens and writes their
one-time values to `~/.config/honowarden/cloudflare-scoped.env` with mode
`0600`. The script prints token hash tags and verification status only; it does
not print token values. Source that file from ignored `.envrc.local` once the
tokens are created:

```sh
source_env_if_exists ~/.config/honowarden/cloudflare-scoped.env
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_HONOWARDEN_READONLY_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
```

Use command-local overrides for write operations so the default environment
stays read-only:

```sh
env -u CLOUDFLARE_API_KEY -u CLOUDFLARE_GLOBAL_API_KEY -u CLOUDFLARE_EMAIL -u CLOUDFLARE_API_EMAIL CLOUDFLARE_API_TOKEN="$CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN" pnpm deploy
env -u CLOUDFLARE_API_KEY -u CLOUDFLARE_GLOBAL_API_KEY -u CLOUDFLARE_EMAIL -u CLOUDFLARE_API_EMAIL CLOUDFLARE_API_TOKEN="$CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN" pnpm wrangler d1 execute honowarden --remote --command "SELECT 1;"
env -u CLOUDFLARE_API_KEY -u CLOUDFLARE_GLOBAL_API_KEY -u CLOUDFLARE_EMAIL -u CLOUDFLARE_API_EMAIL CLOUDFLARE_API_TOKEN="$CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN" pnpm email:preflight -- --strict
```

### Routine Cloudflare Authentication Policy

Routine Cloudflare workflows are scoped-token-only. Use the token assigned to
the workflow; do not substitute the global key:

| Routine workflow                               | Required scoped token                       |
| ---------------------------------------------- | ------------------------------------------- |
| Worker deploy and Worker route attachment      | `CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN`        |
| DNS records and Worker route changes           | `CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN`    |
| Email Routing rules and destination operations | `CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN` |
| D1 migrations/readback and R2 backup/restore   | `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`         |
| Read-only account, zone, and resource evidence | `CLOUDFLARE_HONOWARDEN_READONLY_TOKEN`      |

`CLOUDFLARE_API_TOKEN` is only the command-local transport name for the selected
workflow token. Its presence does not prove the token's permissions; retain the
workflow-specific source variable in the command and verify the expected scope
with Cloudflare. Wrangler prefers complete global-key auth over an API token, so
the routine command examples explicitly remove both global-key and email aliases
from the child environment.

Wrangler can silently use an OAuth session from its operator-owned auth profiles
when no environment credential is set. The email preflight detects profile
filenames only, never opens their contents, and emits a non-blocking warning.
While such a profile exists, a successful Wrangler command does not prove
scoped-only operation. An operator who needs to prove scoped-only operation must
first use a clean shell without Cloudflare environment credentials and run
`wrangler logout` for the default profile. If a named profile is active or the
warning remains, the operator must also use `wrangler auth deactivate` for its
directory binding and `wrangler auth delete <profile>` for the stored profile
before running the command with only the intended scoped token. These commands
mutate operator-owned state, so repository scripts must never run them
automatically.

Remote backup R2 listing uses the S3-compatible R2 API. The current operator
setup derives `R2_ACCESS_KEY_ID` from the D1/R2 scoped token id and derives
`R2_SECRET_ACCESS_KEY` as the SHA-256 hash of that scoped token value, matching
Cloudflare's R2 authentication guidance. These derived values and
`HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE` are stored only in
`~/.config/honowarden/cloudflare-scoped.env` and the GitHub Actions secrets
used by `.github/workflows/remote-backup.yml`.

## Required Local Secrets

| Variable                                    | Required for                              | Notes                                                                                                                             |
| ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `LINEAR_API_KEY`                            | Linear API apply                          | Must belong to an account with access to `https://linear.app/honowarden/`.                                                        |
| `GITHUB_TOKEN`                              | Website repository automation             | Optional if `gh auth status` already has the required repo permissions.                                                           |
| `CLOUDFLARE_API_TOKEN`                      | Command-local scoped-token transport      | Set to the workflow-specific scoped token; never bind it to a broad credential for routine work.                                  |
| `CLOUDFLARE_API_KEY`                        | Cloudflare break-glass tooling            | Global key accepted only for scoped-token remediation and explicit rotation planning; never a routine fallback.                   |
| `CLOUDFLARE_GLOBAL_API_KEY`                 | Cloudflare break-glass tooling            | Alias for the same break-glass key; keep local-only.                                                                              |
| `CLOUDFLARE_EMAIL`                          | Cloudflare break-glass tooling            | Account email paired with the global key only in the two approved break-glass tooling paths.                                      |
| `CLOUDFLARE_API_EMAIL`                      | Cloudflare break-glass tooling            | Alias for the break-glass account email.                                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`                     | Worker deploys and account resources      | Non-secret but operationally sensitive.                                                                                           |
| `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM`         | DNS and email routing on `honowarden.com` | Non-secret but operationally sensitive.                                                                                           |
| `CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN`        | Worker deploy and route attach            | Scoped account token for HonoWarden deploys.                                                                                      |
| `CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN`    | DNS and Worker route changes              | Scoped account token for `honowarden.com` DNS/routes.                                                                             |
| `CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN` | Email Routing changes                     | Scoped account token for Email Routing rules and destination addresses.                                                           |
| `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN`         | D1/R2 operations                          | Scoped account token for migrations, readback, backup, and restore.                                                               |
| `CLOUDFLARE_HONOWARDEN_READONLY_TOKEN`      | Read-only evidence                        | Scoped account token for account/zone/resource evidence collection.                                                               |
| `R2_ACCESS_KEY_ID`                          | Remote R2 listing                         | S3-compatible access key ID for `pnpm backup:export -- --r2-list`; stored local-only and as a GitHub Actions secret.              |
| `R2_SECRET_ACCESS_KEY`                      | Remote R2 listing                         | S3-compatible secret access key for `pnpm backup:export -- --r2-list`; store only in ignored env files or GitHub Actions secrets. |
| `HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE`      | Scheduled backup encryption               | Passphrase for encrypting scheduled backup artifacts before upload.                                                               |
| `HONOWARDEN_SECURITY_FORWARD_TO`            | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_SUPPORT_FORWARD_TO`             | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_GENERAL_FORWARD_TO`             | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_ADMIN_FORWARD_TO`               | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_POSTMASTER_FORWARD_TO`          | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_ABUSE_FORWARD_TO`               | Email routing                             | Destination must be verified in Cloudflare before forwarding.                                                                     |
| `HONOWARDEN_INQUIRY_FORWARD_TO`             | Inquiry inbox forwarding                  | Optional verified destination for the metadata-only Email Worker; keep local-only or Wrangler-secret managed.                     |

Local-only Worker smoke variables are also listed in `.env.example`, but
staging and production must receive them through Wrangler secret commands:

- `HONOWARDEN_BOOTSTRAP_TOKEN`
- `HONOWARDEN_TOKEN_SECRET`
- `HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID`
- `HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET`
- `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS`
- `HONOWARDEN_TOTP_SECRET`
- `HONOWARDEN_AUTH_REQUEST_SECRET`
- `HONOWARDEN_TOTP_OLD_SECRET`
- `HONOWARDEN_TOTP_NEW_SECRET`

Inquiry inbox allowlist and size-cap variables are tracked in `wrangler.jsonc`
because they are operational policy rather than secrets:

- `HONOWARDEN_INQUIRY_DOMAINS`
- `HONOWARDEN_INQUIRY_MAILBOXES`
- `HONOWARDEN_INQUIRY_MAX_RAW_BYTES`

`HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID` is not secret by itself, but keep it in the
same ignored local file as the matching active secret so partial staged-rotation
config does not drift. `HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS` is a JSON array
of prior signing keys and must be handled as a secret. See
[Access Token Key Rotation](access-token-key-rotation.md).

`HONOWARDEN_TOTP_OLD_SECRET` and `HONOWARDEN_TOTP_NEW_SECRET` are local-only
operator inputs for [TOTP Secret Rotation](totp-secret-rotation.md). They are
not Worker runtime variable names and must not be committed, logged, or copied
into Linear/GitHub evidence.

`HONOWARDEN_TOKEN_SECRET` also keys the domain-separated, email-stable selection
used for allowlisted accounts that do not exist. The selection is weighted by
the current stored KDF population, including readable legacy generations, and
therefore emits only a resource profile already in use. Allowed prelogin fails
with `503 server_misconfigured` before D1 access when this secret is missing or
blank, so known and unknown accounts share the same configuration failure
boundary. Rotating the secret or changing the stored population can remap an
unknown-account decoy; neither changes a known account's exact projection or
any stored KDF generation. The allowlist remains the primary prelogin boundary.

## KDF Mutation Rollout

`HONOWARDEN_KDF_MUTATION_ENABLED` is a non-secret, default-off rollout gate for
`POST /api/accounts/kdf`. Only exact `true` after trimming and case
normalization enables the writer. Missing, blank, false, or any other value
returns `501 unsupported_feature` before authentication or database mutation.
PBKDF2 and Argon2id readers remain active regardless of this flag so disabling
new writes never locks an account that already committed an Argon2id generation.

The first deployment of KDF-capable code must keep the flag false in every
environment. Verify its prelogin, token, profile, sync, backup, and
authentication readers before creating a second Worker version that enables the
flag. Record that first version as the reader-capable rollback target. After any
Argon2id generation has committed, rollback means disabling the writer or
deploying that reader-capable version; never deploy a pre-reader release that
projects every stored generation as PBKDF2.

The tracked top-level, staging, and production values remain false. The local
synthetic lifecycle passes an explicit Wrangler `--var` override and is not
deployment activation evidence. Production activation requires separate
operator approval and official-client credential closeout evidence.

## WebAuthn Runtime Policy

HON-208 defines the configuration contract only. It does not add a WebAuthn
route, migration, verifier dependency, advertised feature, deployed capability,
or live authenticator support. The four policy inputs are non-secret but
environment-owned:

| Variable                                       | Meaning                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `HONOWARDEN_WEBAUTHN_ENABLED`                  | Exact `true` requests use of a completely valid policy; default false. |
| `HONOWARDEN_WEBAUTHN_RP_ID`                    | Canonical lowercase RP ID controlled by the operator.                  |
| `HONOWARDEN_WEBAUTHN_ORIGINS`                  | Comma-separated exact Web origins accepted for that RP ID.             |
| `HONOWARDEN_WEBAUTHN_ALLOW_INSECURE_LOCALHOST` | Exact `true` permits only `http://localhost[:port]` for local testing. |

`HONOWARDEN_WEBAUTHN_RP_ID` and `HONOWARDEN_WEBAUTHN_ORIGINS` must not be
derived from request headers, including `Host`, `Origin`, `Forwarded`,
`X-Forwarded-*`, or Cloudflare visitor headers. Existing public-URL and CORS
logic is not a WebAuthn trust source. Configure every accepted origin exactly;
the RP ID may equal the origin hostname or be its DNS-label parent. A string
suffix such as `evil-example.com` never matches RP ID `example.com`.

The resolver has three states:

- `disabled`: the enabled value is absent, blank, or false. Other policy input
  is ignored because no ceremony may start.
- `ready`: the enabled value is true and every RP/origin/local-development rule
  validates. This is configuration readiness only, not source or live support.
- `misconfigured`: enablement is ambiguous or enabled policy is incomplete or
  invalid. The resolver returns status: `misconfigured`, stable non-secret error
  codes, no partial allowlist, and no raw configuration value.

Production-like origins require HTTPS. Credentials in URLs, wildcards, paths,
queries, fragments, custom schemes, IP-address RP IDs, cross-RP hosts, and
malformed values fail closed. HTTP is rejected even when the local opt-in is
true unless the hostname is exactly `localhost`; loopback IPs and localhost
subdomains are not aliases. The origin list is bounded at 16 entries before
deduplication. Only scheme/host case, an optional root slash, and an explicit
default port may normalize; backslashes, dot segments, encoded/Unicode hosts,
embedded controls, and non-canonical ports fail closed.

The tracked `wrangler.jsonc` pins `HONOWARDEN_WEBAUTHN_ENABLED=false` for the
top-level, staging, and production environments. It intentionally contains no
real RP ID or origin value. `.env.example` provides blank local placeholders.
HON-213 owns the reviewed environment-specific activation and rollback
mechanism after schema, routes, lifecycle transitions, and fixtures exist.
Until then, do not set the flag true in any deployed environment.

Never put RP IDs, origins, policy parser inputs, raw challenges, credential IDs,
public keys, user handles, attestation/assertion payloads, or PRF extension
results into issue comments or verification logs. See
[WebAuthn Threat Model](../security/webauthn-threat-model.md) and
[WebAuthn Contract](../specs/webauthn-contract.md).

## External Write Gates

These actions require explicit operator approval in the active thread before the
agent performs them:

- creating or mutating Linear issues, projects, views, documents, or Pulse
  updates
- creating the `HonoWarden-website` repository
- deploying Workers
- executing account lifecycle D1 mutations with `pnpm account:lifecycle -- --execute`
- changing Cloudflare DNS, routes, email routing, destinations, or MX records
- setting or rotating Wrangler secrets
- sending email or configuring auto-replies

Read-only checks that are safe to run without approval:

```sh
gh auth status
pnpm wrangler whoami
pnpm linear:seed
pnpm linear:preflight
pnpm linear:apply-plan
pnpm linear:mutation-packet -- --apply-plan <ready-apply-plan>
pnpm linear:request-plan -- --mutation-packet <ready-mutation-packet>
pnpm linear:resolution-plan -- --request-plan <ready-request-plan> --resolution-map <local-resolution-map>
pnpm email:preflight
pnpm account:lifecycle -- disable --email <email> --database <database> --reason <reason>
```

## Validation Checklist

Before applying external changes:

1. `direnv status` shows this repository is allowed.
2. `pnpm linear:preflight -- --strict` reports `status: "ready"` before Linear
   API writes are planned.
3. `pnpm linear:apply-plan -- --preflight-report <ready-report> --strict`
   produces a reviewed plan before Linear writes are attempted.
4. `pnpm linear:mutation-packet -- --apply-plan <ready-apply-plan> --strict`
   produces a reviewed packet before any guarded writer is used.
5. `pnpm linear:request-plan -- --mutation-packet <ready-mutation-packet> --strict`
   produces a reviewed request contract before any guarded writer is used.
6. `pnpm linear:resolution-plan -- --request-plan <ready-request-plan> --resolution-map <local-resolution-map> --strict`
   proves the reviewed local ID map is complete before any guarded writer is
   used.
7. `gh auth status` resolves to the intended GitHub user.
8. `pnpm wrangler whoami` resolves to the intended Cloudflare account and reports
   API Token auth for scoped-only evidence; account identity alone is not proof
   when a Wrangler OAuth session exists on disk.
9. `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` points to `honowarden.com`.
10. Destination inboxes for email routing are verified in Cloudflare.
11. The current worktree is clean or the pending diff is intentionally scoped.

Use strict local preflight before requesting email-routing writes:

```sh
pnpm email:preflight -- --strict
```

The report prints only configured/missing status for API auth and destination
inboxes. It accepts `CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN` or a
workflow-scoped `CLOUDFLARE_API_TOKEN`. Any configured global key fails with a
break-glass structural reason, including when a scoped token is also present,
because Wrangler would prefer complete global-key auth. A detected
Wrangler OAuth auth profile appears as a non-blocking warning because command
success cannot prove which credential Wrangler used. The report does not print
token values, global key values, operator emails, forwarding addresses,
auth-profile paths, names, or contents.

## Current Linear Access

The intended workspace is `https://linear.app/honowarden/`, but the currently
connected Linear MCP session resolves to an existing `interx` workspace. Do not
create or update HonoWarden Linear projects, issues, documents, views, or Pulse
updates through that session.

Use one of these before Linear writes:

- provide `LINEAR_API_KEY` for the `honowarden` workspace through `.env.local`;
  then run `pnpm linear:preflight -- --strict` and require the workspace
  `urlKey`, team, and workflow state type checks to pass; or
- reconnect the Linear MCP session so list/read calls return the HonoWarden
  workspace instead of `interx`.

`pnpm linear:preflight` calls the Linear GraphQL API read-only. It does not
create issues, projects, labels, documents, views, comments, or Pulse updates.
It fails closed when `LINEAR_API_KEY` is missing, when the API key resolves to a
workspace whose `urlKey` is not `honowarden`, when the `HON` / `HonoWarden` team
is absent, or when the team's workflow state types cannot represent the seed's
issue `stateType` values. It also rejects custom GraphQL endpoints before
sending the API key, so local endpoint overrides cannot exfiltrate the token. If
`HONOWARDEN_LINEAR_WORKSPACE_SLUG` is set locally, it must match the checked-in
seed; it cannot override the workspace that preflight verifies. The report
inventories matching seed projects, labels, documents, and views without
printing the API key. Project-scoped views are listed for manual confirmation
because the read-only root view inventory does not prove that scope.

`pnpm linear:apply-plan` is also local-only. It reads the seed and, optionally,
a saved ready preflight report, then emits ordered create/confirm/manual
operations for review. Ready reports must match the current seed fingerprint
and page-complete inventory expected-name set before the plan can classify
objects as already present. It does not read `LINEAR_API_KEY`, does not call
GraphQL, and does not create or update Linear objects.

`pnpm linear:mutation-packet` is the next local-only handoff step. It reads a
ready apply-plan JSON, emits mutation candidates, existing-object confirmations,
and manual confirmations for review, and intentionally omits executable buckets
when the input plan is blocked. It does not read credentials, resolve Linear
IDs, call GraphQL, or create or update Linear objects.

`pnpm linear:request-plan` is also local-only. It reads a ready mutation packet
and emits request intents, unresolved ID requirements, confirmations, and manual
confirmations for a future guarded writer. It uses local intent names instead of
unverified live GraphQL mutation names. It does not read credentials, resolve
Linear IDs, call GraphQL, or create or update Linear objects.

`pnpm linear:resolution-plan` is the local ID-map completeness check. It reads a
ready request plan and a supplied resolution map, then reports resolved and
missing IDs for a future guarded writer. It does not read credentials, fetch ID
data from Linear, call GraphQL, or create or update Linear objects.

## Missing Inputs

The agent can continue with local planning and repo changes without these
values. External writes need the following from the operator:

- a Linear API key for the `honowarden` workspace, or a fixed Linear MCP session
  that returns the HonoWarden team
- inbound smoke confirmation for the configured security, support, general,
  admin, postmaster, and abuse project mail routes
