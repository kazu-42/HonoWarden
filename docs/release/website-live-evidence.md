# Website Live Evidence

Target: `v0.1.0-alpha`.

Status: not_performed.

Mode: public website deploy, route, and HTTPS smoke evidence.

This file is the required evidence placeholder for the public
`honowarden.com` website. It must remain `not_performed` until the website
repository deployment, custom domain route, HTTPS checks, and rollback handle
are recorded.

The website is intentionally separate from the API repository. This evidence
does not deploy the API Worker and does not prove API health.

## Required Approval Before Execution

Website deploy or route approval must explicitly name:

- website repository: `kazu-42/HonoWarden-website`
- commit SHA or deployment id
- Cloudflare account and zone
- route targets for `honowarden.com` and `www.honowarden.com`
- rollback route or previous deployment id

Do not infer approval from the API release publication, API CI, or local
website build output.

## Evidence To Record After Deploy

Record these values after the approved website deploy or route change:

- approval text and timestamp
- website repository commit SHA
- website CI run URL
- deployment id or Worker version id
- Cloudflare account identity
- zone name
- route for `honowarden.com/*`
- route or redirect for `www.honowarden.com/*`
- previous deployment id or rollback route
- HTTPS response for `https://honowarden.com/`
- HTTPS response for `https://www.honowarden.com/`
- response for `/health`
- release-note link target
- security contact visibility decision
- abort or rollback decision

Do not publish a security contact address as active until inbound email has also
been verified.

## Smoke Commands

```sh
curl -fsSI https://honowarden.com/
curl -fsSI https://www.honowarden.com/
curl -fsS https://honowarden.com/health
```

If the website includes build metadata, record the redacted value here.

## Not Performed

- Website deploy has not been performed by this evidence file.
- DNS or route mutation has not been performed by this evidence file.
- HTTPS smoke has not been performed by this evidence file.
- Email contact verification has not been performed by this evidence file.

## Rollback

If the website deploy or domain route fails:

1. Restore the previous website deployment or route.
2. Re-run HTTPS checks for apex and `www`.
3. Record the previous deployment id or route that was restored.
4. Keep the public site conservative until the rollback is confirmed.
