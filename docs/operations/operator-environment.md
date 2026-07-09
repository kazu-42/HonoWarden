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

For Cloudflare global API key auth, prefer a home-directory secret file instead
of storing the value in the repository checkout:

```sh
mkdir -p ~/.config/honowarden
chmod 700 ~/.config/honowarden
$EDITOR ~/.config/honowarden/cloudflare.env
chmod 600 ~/.config/honowarden/cloudflare.env
```

Then source it from ignored `.envrc.local`:

```sh
source_env_if_exists ~/.config/honowarden/cloudflare.env
```

The current operator setup uses this pattern for local-only Cloudflare global
key auth. Do not commit the home env file, `.envrc.local`, or any rendered
Cloudflare key value.

## Required Local Secrets

| Variable                            | Required for                              | Notes                                                                      |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `LINEAR_API_KEY`                    | Linear API apply                          | Must belong to an account with access to `https://linear.app/honowarden/`. |
| `GITHUB_TOKEN`                      | Website repository automation             | Optional if `gh auth status` already has the required repo permissions.    |
| `CLOUDFLARE_API_TOKEN`              | Cloudflare API automation                 | Prefer a scoped token over a global key.                                   |
| `CLOUDFLARE_API_KEY`                | Cloudflare API automation fallback        | Global key fallback; keep local-only and pair with account email.          |
| `CLOUDFLARE_GLOBAL_API_KEY`         | Cloudflare API automation fallback        | Alias for the global key fallback; keep local-only.                        |
| `CLOUDFLARE_EMAIL`                  | Cloudflare global key auth                | Required when using a global key.                                          |
| `CLOUDFLARE_API_EMAIL`              | Cloudflare global key auth                | Alias for the account email used by global key auth.                       |
| `CLOUDFLARE_ACCOUNT_ID`             | Worker deploys and account resources      | Non-secret but operationally sensitive.                                    |
| `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` | DNS and email routing on `honowarden.com` | Non-secret but operationally sensitive.                                    |
| `HONOWARDEN_SECURITY_FORWARD_TO`    | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_SUPPORT_FORWARD_TO`     | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_GENERAL_FORWARD_TO`     | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_ADMIN_FORWARD_TO`       | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_POSTMASTER_FORWARD_TO`  | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_ABUSE_FORWARD_TO`       | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |

Local-only Worker smoke variables are also listed in `.env.example`, but
staging and production must receive them through Wrangler secret commands:

- `HONOWARDEN_BOOTSTRAP_TOKEN`
- `HONOWARDEN_TOKEN_SECRET`
- `HONOWARDEN_TOTP_SECRET`

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
8. `pnpm wrangler whoami` resolves to the intended Cloudflare account.
9. `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` points to `honowarden.com`.
10. Destination inboxes for email routing are verified in Cloudflare.
11. The current worktree is clean or the pending diff is intentionally scoped.

Use strict local preflight before requesting email-routing writes:

```sh
pnpm email:preflight -- --strict
```

The report prints only configured/missing status for API auth and destination
inboxes. It accepts either `CLOUDFLARE_API_TOKEN`, or a local-only global key
with `CLOUDFLARE_EMAIL`. It does not print token values, global key values,
operator emails, or forwarding addresses.

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
