# Operator Environment

This document defines the local operator environment for HonoWarden automation.
It keeps project URLs and non-secret defaults in git while keeping API keys,
Cloudflare tokens, destination inboxes, and runtime secrets outside git.

## Scope

Use this environment for local automation only:

- validating the Linear seed
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

## Required Local Secrets

| Variable                            | Required for                              | Notes                                                                      |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `LINEAR_API_KEY`                    | Linear API apply                          | Must belong to an account with access to `https://linear.app/honowarden/`. |
| `GITHUB_TOKEN`                      | Website repository automation             | Optional if `gh auth status` already has the required repo permissions.    |
| `CLOUDFLARE_API_TOKEN`              | Cloudflare API automation                 | Prefer a scoped token over a global key.                                   |
| `CLOUDFLARE_ACCOUNT_ID`             | Worker deploys and account resources      | Non-secret but operationally sensitive.                                    |
| `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` | DNS and email routing on `honowarden.com` | Non-secret but operationally sensitive.                                    |
| `HONOWARDEN_SECURITY_FORWARD_TO`    | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_SUPPORT_FORWARD_TO`     | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |
| `HONOWARDEN_GENERAL_FORWARD_TO`     | Email routing                             | Destination must be verified in Cloudflare before forwarding.              |

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
- changing Cloudflare DNS, routes, email routing, destinations, or MX records
- setting or rotating Wrangler secrets
- sending email or configuring auto-replies

Read-only checks that are safe to run without approval:

```sh
gh auth status
pnpm wrangler whoami
pnpm linear:seed
```

## Validation Checklist

Before applying external changes:

1. `direnv status` shows this repository is allowed.
2. `printenv LINEAR_API_KEY` is non-empty when Linear API writes are planned.
3. `gh auth status` resolves to the intended GitHub user.
4. `pnpm wrangler whoami` resolves to the intended Cloudflare account.
5. `CLOUDFLARE_ZONE_ID_HONOWARDEN_COM` points to `honowarden.com`.
6. Destination inboxes for email routing are verified in Cloudflare.
7. The current worktree is clean or the pending diff is intentionally scoped.

## Missing Inputs

The agent can continue with local planning and repo changes without these
values. External writes need the following from the operator:

- a Linear API key for the `honowarden` workspace, or a fixed Linear MCP session
  that returns the HonoWarden team
- Cloudflare account id and `honowarden.com` zone id
- a scoped Cloudflare API token that can manage Workers, DNS, and Email Routing
  for `honowarden.com`
- verified forwarding destination addresses for security, support, and general
  project mail
- approval to create or update `kazu-42/HonoWarden-website`
