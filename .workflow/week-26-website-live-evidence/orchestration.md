# Orchestration: Week 26 website live evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If Email Routing permissions become available and inbound delivery can be
  verified, security contact metadata may be restored in the same release lane.
- If Email Routing remains blocked, ship repository policy links only and keep
  public mailbox metadata absent.
- If website CI or local review fails, fix website before any Cloudflare deploy.
- If deploy succeeds but live smoke fails, rollback to the latest known-good
  website version and record both handles.

## Packet Prompts

### spark-website-public-links

Objective: Patch `/Users/hackhike/dev/HonoWarden-website` so the homepage links
to release notes and the repository security policy, but does not advertise
`security@honowarden.com` or `security.txt`.

Ownership: `src/index.ts` and `test/app.test.ts` only.

Do:

- Add constants or local links for:
  - `https://github.com/kazu-42/HonoWarden/releases/tag/v0.1.0-alpha`
  - `https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md`
- Replace active `mailto:security@honowarden.com` / `security.txt` UI with
  repository policy and release links.
- Remove or disable `/.well-known/security.txt` and `/security.txt` routes until
  Email Routing is verified.
- Update tests to assert release/security policy links are present, mailbox
  metadata is absent, and `/.well-known/security.txt` is not active.

Do not:

- Deploy.
- Run QA as the delegated output.
- Edit docs, package metadata, or Cloudflare config.
- Reintroduce compatibility-brand wording.

Expected output: A concise summary and changed file paths.

## Completion Audit

- Website patch accepted and committed.
- Website PR merged to main with CI green.
- Cloudflare deployment from merged website commit recorded.
- Main repository evidence PR merged with readiness readback updated.
