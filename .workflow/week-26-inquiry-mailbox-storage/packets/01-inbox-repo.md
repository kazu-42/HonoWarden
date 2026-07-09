# Packet 01: Inbox Repo

## Scope

Create and verify the dedicated `kazu-42/HonoWarden-inquiry-inbox` repository.

## Accepted Output

- Separate Worker project with `email()` handler.
- D1 schema for `inquiry_threads`, `inquiry_messages`, `inquiry_events`, and
  `schema_migrations`.
- Tests for accepted metadata-only storage, attachment rejection, recipient
  rejection, size rejection, forwarding, repository writes, and migrations.
- Staging and production D1/R2 resources created and migrated.
- Staging and production Workers deployed.
- Existing public aliases left forwarding-only.
- Hidden `inquiry-smoke@honowarden.com` route points to the production Worker.

## Rejected Output

- Raw message body storage.
- Attachment storage.
- Private forwarding destinations in git, docs, Linear, or chat.
- Public alias migration.
- Outbound replies, AI triage, or Linear automation.

## Verification

- `pnpm test`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- GitHub Actions CI
- Cloudflare D1/Worker/Email Routing readback
