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
- Initial website PR: `https://github.com/kazu-42/HonoWarden-website/pull/1`
- Initial website merge commit:
  `36b8171f7afd55bf306e5482cca454a0b3822a39`
- Security metadata PR: `https://github.com/kazu-42/HonoWarden-website/pull/2`
- Security metadata merge commit:
  `97095812384b47e5a1798108d77d8224f75509f2`
- Security metadata CI:
  `https://github.com/kazu-42/HonoWarden-website/actions/runs/29024992828`
- CI job:
  `https://github.com/kazu-42/HonoWarden-website/actions/runs/29024992828/job/86142117767`
- CI result: `Typecheck, lint, and test` passed in 23s

Local validation before the security metadata PR:

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `git diff --check`
- local `wrangler dev` route smoke for `/`, `/.well-known/security.txt`,
  `/security.txt`, and `/health`
- non-`honowarden.com` email scan returned zero files

## Cloudflare Deployment

- Cloudflare account: `gHive`
- Account ID: `7e31a4cfe4ffd2cfff49c04236261de8`
- Zone: `honowarden.com`
- Zone ID: `f943f9ad49c08ef28fe641cf9277b1ed`
- Worker: `honowarden-website`
- Deployment command: `pnpm deploy`
- Deployment ID: `1c3fc838-3e84-448a-ba36-a8181f3e6eed`
- Worker version ID: `b408a4e2-4279-4a57-8172-698b1c77c6ab`
- Version number: `5`
- Deployment created: `2026-07-09T14:22:01.056646Z`
- Current deployment readback: Worker version
  `b408a4e2-4279-4a57-8172-698b1c77c6ab` receiving `100%` traffic
- workers.dev URL: `https://honowarden-website.ghive42.workers.dev`
- Custom domain: `honowarden.com`
- Custom domain: `www.honowarden.com`

## Live Smoke

Commands:

```sh
curl -fsSI https://honowarden.com/
curl -fsSI https://www.honowarden.com/
curl -fsS https://honowarden.com/.well-known/security.txt
curl -fsS https://www.honowarden.com/.well-known/security.txt
curl -fsSI https://honowarden.com/security.txt
curl -fsSI https://www.honowarden.com/security.txt
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
- `https://honowarden.com/.well-known/security.txt`: HTTP `200`,
  `content-type: text/plain; charset=utf-8`
- `https://www.honowarden.com/.well-known/security.txt`: HTTP `200`,
  `content-type: text/plain; charset=utf-8`
- `https://honowarden.com/security.txt`: HTTP `308`, redirects to
  `/.well-known/security.txt`
- `https://www.honowarden.com/security.txt`: HTTP `308`, redirects to
  `/.well-known/security.txt`
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
- contains verified public security contact:
  `mailto:security@honowarden.com`
- contains `/.well-known/security.txt`

Security metadata assertions passed for both `honowarden.com` and
`www.honowarden.com`:

- contains `Contact: mailto:security@honowarden.com`
- contains policy link:
  `https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md`
- contains `Preferred-Languages: en, ja`
- contains canonical URL:
  `https://honowarden.com/.well-known/security.txt`
- contains `Expires: 2027-07-08T00:00:00Z`

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

The public website now advertises `security@honowarden.com`,
`mailto:security@honowarden.com`, and `security.txt` because Cloudflare Email
Routing destination verification and inbound smoke evidence passed before this
deployment. The website still records only the public domain mailbox; it does
not record private forwarding destinations, mailbox contents, tokens, or
Cloudflare keys.

## Rollback

Previous known-good website deployment:

- Previous deployment ID: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Previous Worker version ID: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Previous deployment created: `2026-07-08T02:18:44.374906Z`
- Previous status: live domain smoke passed before security metadata was
  published, and did not advertise the public security mailbox or
  `security.txt`

Rollback command:

```sh
pnpm exec wrangler rollback eef4ab71-d6e8-401f-93c3-27e7bd2bcd91 --name honowarden-website --yes
```

Rollback was not executed because post-deploy smoke passed. If rollback is
needed later because the security contact route stops delivering, run the
command above to remove the public metadata, then re-run the apex and `www`
homepage, `/.well-known/security.txt`, `/security.txt`, and `/health` checks and
record the resulting deployment ID.
