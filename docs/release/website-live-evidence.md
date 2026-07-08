# Website Live Evidence

Target: `v0.1.0-alpha`.

Status: passed.

Mode: public website deploy, route, and HTTPS smoke evidence.

This file records the public `honowarden.com` website deployment, custom domain
route, HTTPS checks, and rollback handle for the alpha publication lane.

The website is intentionally separate from the API repository. This evidence
does not deploy the API Worker and does not prove API health.

## Approval And Source

Standing operator approval was provided on 2026-07-08 for project-scoped
GitHub and Cloudflare writes without per-command confirmation.

- Website repository: `kazu-42/HonoWarden-website`
- Website PR: `https://github.com/kazu-42/HonoWarden-website/pull/1`
- Website PR status: merged at `2026-07-08T02:18:19Z`
- PR head commit: `2634b92a4745b6d7beda04ae01d35c1f8b4bfa66`
- Merge commit deployed: `36b8171f7afd55bf306e5482cca454a0b3822a39`
- Website CI: `https://github.com/kazu-42/HonoWarden-website/actions/runs/28912678963`
- CI job: `https://github.com/kazu-42/HonoWarden-website/actions/runs/28912678963/job/85773153323`
- CI result: `Typecheck, lint, and test` passed in 19s

Local validation before PR:

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `git diff --check`
- `codex review --uncommitted`

The Codex review found no actionable correctness issues. Its read-only sandbox
could not run Vitest because Vite attempted to write temporary cache files, so
the normal workspace `pnpm test` result is the authoritative local test
execution for this evidence.

## Cloudflare Deployment

- Cloudflare account: `gHive`
- Account ID: `7e31a4cfe4ffd2cfff49c04236261de8`
- Zone: `honowarden.com`
- Zone ID: `f943f9ad49c08ef28fe641cf9277b1ed`
- Worker: `honowarden-website`
- Deployment command: `pnpm deploy`
- Deployment ID: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Worker version ID: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Version number: `4`
- Version created: `2026-07-08T02:18:41.635978Z`
- Deployment created: `2026-07-08T02:18:44.374906Z`
- Worker script etag:
  `2864ab2e568d426e720830831d35cc4aba49d2ad7cf658ca954dd37e90d14655`
- workers.dev URL: `https://honowarden-website.ghive42.workers.dev`
- Custom domain: `honowarden.com`
- Custom domain: `www.honowarden.com`

## Live Smoke

Commands:

```sh
curl -fsSI https://honowarden.com/
curl -fsSI https://www.honowarden.com/
curl -fsS https://honowarden.com/health
curl -fsS https://www.honowarden.com/health
```

Results:

- `https://honowarden.com/`: HTTP `200`, `content-type: text/html; charset=UTF-8`
- `https://www.honowarden.com/`: HTTP `200`,
  `content-type: text/html; charset=UTF-8`
- Both root responses include defensive headers including
  `content-security-policy`, `strict-transport-security`, and
  `x-frame-options: DENY`
- `https://honowarden.com/health`:
  `{"status":"ok","service":"honowarden-website"}`
- `https://www.honowarden.com/health`:
  `{"status":"ok","service":"honowarden-website"}`

Homepage assertions passed for both `honowarden.com` and
`www.honowarden.com`:

- contains release notes link:
  `https://github.com/kazu-42/HonoWarden/releases/tag/v0.1.0-alpha`
- contains security policy link:
  `https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md`
- does not contain `security@honowarden.com`
- does not contain `mailto:`
- does not contain `/.well-known/security.txt`

Security metadata routes intentionally remain inactive until Email Routing is
verified:

- `https://honowarden.com/.well-known/security.txt`: HTTP `404`
- `https://honowarden.com/security.txt`: HTTP `404`
- `https://www.honowarden.com/.well-known/security.txt`: HTTP `404`
- `https://www.honowarden.com/security.txt`: HTTP `404`

## Linked Target Readback

The release notes target was read back from GitHub:

- Release URL:
  `https://github.com/kazu-42/HonoWarden/releases/tag/v0.1.0-alpha`
- Release target:
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- Release state: `isDraft=false`, `isPrerelease=true`
- Published at: `2026-07-08T01:37:46Z`

The security policy target was read back from GitHub:

- Path: `SECURITY.md`
- URL: `https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md`
- Blob SHA: `1524940b756166712d175140297af5e68b5019b0`

## Security Contact Visibility Decision

The public website intentionally does not advertise `security@honowarden.com`,
`mailto:security@honowarden.com`, or `security.txt` as active metadata in this
deployment. Cloudflare Email Routing remains unverified, so the website points
to the repository security policy only. The active security mailbox and
machine-readable `security.txt` can be restored after destination verification
and inbound smoke evidence pass.

## Rollback

Previous known-good website deployment:

- Previous deployment ID: `5b1f701c-4654-46e5-bca7-09de61316783`
- Previous Worker version ID: `3db432cb-6422-4311-b558-6eb2b0b5bb51`
- Previous deployment created: `2026-07-06T12:25:16.618097Z`
- Previous status: live domain smoke passed before this deployment and did not
  advertise an active unverified security mailbox

Rollback command:

```sh
pnpm exec wrangler rollback 3db432cb-6422-4311-b558-6eb2b0b5bb51 --name honowarden-website --yes
```

Rollback was not executed because post-deploy smoke passed. If rollback is
needed later, run the command above, then re-run the apex and `www` HTTPS
checks and record the resulting deployment ID.
