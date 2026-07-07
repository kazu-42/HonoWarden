# Worker Live Smoke Evidence

Target: `v0.1.0-alpha`.

Status: not_performed.

Mode: post-alpha Worker deploy and live HTTP smoke evidence.

This file is the required evidence placeholder for the API Worker after a
separate deploy approval is granted. It must remain `not_performed` until the
Worker has actually been deployed, queried over HTTPS, and verified with
redacted outputs.

Do not mark this evidence as passed from local tests, staging dry-run output,
GitHub Actions status, or Cloudflare resource creation alone. Those checks are
useful prerequisites, but they do not prove that a live Worker is serving the
expected version.

## Required Approval Before Execution

Worker deploy approval must explicitly name:

- repository: `kazu-42/HonoWarden`
- environment: staging or production
- commit SHA to deploy
- rollback command or previous deployment handle
- whether secrets may be written

Do not deploy from the GitHub Release publication gate. Release publication and
Worker deployment are separate external writes.

## Evidence To Record After Deploy

Record these values after the approved deploy:

- approval text and timestamp
- commit SHA deployed
- CI run URL for the deployed commit
- Wrangler version
- Cloudflare account identity
- environment name
- Worker name
- deployed Worker URL
- deployment id or version id, if Wrangler prints one
- previous deployment id or rollback handle
- redacted output from `GET /health`
- redacted output from `GET /healthz`
- redacted output from `GET /health/db`
- redacted output from `GET /api/config`
- result of a synthetic prelogin request
- abort or rollback decision

Health responses must not include secrets, tokens, private email addresses, or
real vault data. Synthetic account checks must use test-only data.

## Commands

Use staging first:

```sh
pnpm wrangler deploy --env staging
```

Production deployment requires a separate approval:

```sh
pnpm wrangler deploy --env production
```

Smoke commands should target the deployed HTTPS URL:

```sh
curl -fsS "$HONOWARDEN_API_URL/health"
curl -fsS "$HONOWARDEN_API_URL/healthz"
curl -fsS "$HONOWARDEN_API_URL/health/db"
curl -fsS "$HONOWARDEN_API_URL/api/config"
```

## Not Performed

- Worker deploy has not been performed by this evidence file.
- Live HTTP smoke has not been performed by this evidence file.
- Production secrets have not been written by this evidence file.
- Rollback has not been exercised by this evidence file.

## Rollback

If deploy or smoke validation fails:

1. Stop promotion.
2. Redeploy the previous Worker version or remove the route, depending on the
   approved rollback plan.
3. Re-run `/health`, `/healthz`, and `/health/db` against the restored target.
4. Record the rollback timestamp and resulting health response.
