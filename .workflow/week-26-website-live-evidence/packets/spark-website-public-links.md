# Packet: spark-website-public-links

## Objective

Patch the website homepage so it links to the v0.1.0-alpha release notes and
repository security policy without advertising unverified email routes.

## Context

Cloudflare Email Routing is not yet verified for `honowarden.com`, so the public
site must not expose `security@honowarden.com`, `mailto:security@honowarden.com`,
or active `security.txt` metadata.

## Ownership

- `/Users/hackhike/dev/HonoWarden-website/src/index.ts`
- `/Users/hackhike/dev/HonoWarden-website/test/app.test.ts`

## Do

- Add links to:
  - `https://github.com/kazu-42/HonoWarden/releases/tag/v0.1.0-alpha`
  - `https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md`
- Remove active mailto and `security.txt` public metadata.
- Update tests for the link and route behavior.

## Do Not

- Deploy.
- Perform QA as the delegated task.
- Edit docs, Cloudflare config, branches, commits, or package metadata.
