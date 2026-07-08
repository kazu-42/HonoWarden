# Week 26 website live evidence

## Goal

Ship a live `honowarden.com` homepage that supports the Week 26 release
readiness packet without advertising unverified email routes.

## Success Criteria

- `HonoWarden-website` renders direct links to the v0.1.0-alpha release notes
  and the repository security policy.
- The deployed website does not expose `security@honowarden.com`,
  `mailto:security@honowarden.com`, or `security.txt` as active contact
  metadata until Cloudflare Email Routing is verified.
- Website checks, PR CI, and merge readback pass.
- Cloudflare deployment readback records account, version, deployment, custom
  domains, smoke results, and a rollback candidate.
- The main `HonoWarden` release readiness packet no longer blocks on
  `website_live_evidence_missing`.

## Current Context

- API release `v0.1.0-alpha` is published and API Worker live smoke passed.
- Website live domain currently serves an older deployment that does not expose
  the unverified security mailbox, but the website repo `main` HEAD currently
  adds active `security@honowarden.com` / `security.txt` metadata.
- Current Wrangler OAuth can deploy Workers but lacks `email_routing:write`.

## Constraints

- Keep product/code text free of compatibility-brand claims.
- Do not publish active vulnerability-reporting mailboxes until inbound email is
  configured and tested.
- Use Spark only for simple implementation, not QA.
- Use PR/CI/merge and local review before deploying from the merged website
  commit.

## Risks

- Deploying the current website HEAD would create a false public security
  contact.
- Updating evidence before live deployment would make readiness stale.
- Rollback evidence must distinguish approved rollback targets from incidental
  previous versions.

## Approval Required

The user granted standing approval for project-scoped external writes. Proceed
with GitHub PR/merge, Cloudflare deploy, and readback without per-command
approval while preserving rollback and evidence notes.

## Work Packets

- `spark-website-public-links`: update website code/tests only, adding release
  and security-policy links while removing active email/security.txt advertising.
- `main-deploy-evidence`: verify/merge/deploy website and record live evidence
  in the main repository.

## Integration Policy

Accept the Spark patch only after reviewing the exact diff. Do not delegate
deployment or QA to Spark.

## Verification

- Website: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm format`,
  `codex review --uncommitted`, GitHub CI.
- Live website: `curl` apex/www root and `/health`; assert release/security
  policy links are present and unverified email/security.txt are absent.
- Main repo: release docs tests, ops readiness packet, release gate, brand scan,
  workflow verifier.

## Reusable Artifacts

This workflow should become the template for future public-site evidence gates:
code link hygiene first, merge, deploy, live smoke, then main release evidence.
