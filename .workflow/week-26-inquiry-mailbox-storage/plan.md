# Week 26 Inquiry Mailbox Storage

## Goal

Close the HON-24 implementation boundary for HonoWarden inbound inquiry mailbox
storage without expanding the blast radius of the vault API Worker.

## Success Criteria

- `kazu-42/HonoWarden-inquiry-inbox` owns the inbound Email Routing Worker code.
- The inquiry Worker has separate staging and production Cloudflare Workers,
  D1 databases, R2 buckets, secrets, and routing from the vault API Worker.
- Accepted inbound messages persist metadata-only D1 rows with retention
  deadlines.
- Raw MIME and attachment object writes remain disabled.
- Attachment-bearing messages are rejected before body or attachment storage is
  enabled.
- Existing public aliases remain forwarding-only until a hidden route smoke
  passes and a reversible migration is approved.
- HonoWarden operations docs and tests record the implementation boundary.
- No private forwarding destination, mailbox content, account email, API key,
  token value, or Worker secret value is committed.

## Current Context

- The user approved Cloudflare routing, D1/R2, retention, and a new repository
  for this work.
- The implementation repository is public and separate from this vault API repo.
- Hidden Email Routing smoke uses `inquiry-smoke@honowarden.com`.
- Public aliases for `security`, `support`, `hello`, `admin`, `postmaster`, and
  `abuse` still use forwarding-only rules.

## Constraints

- Do not print, commit, or paste private forwarding destinations, mailbox
  contents, account member emails, API keys, token values, or Worker secrets.
- Do not migrate public aliases to the Worker in this slice.
- Do not implement outbound replies, operator UI, AI triage, or Linear issue
  creation in HON-24.
- Do not mark HON-24 Done until production D1 or equivalent Cloudflare readback
  proves the hidden live route processed a message.

## Risks

- Treating local Email Routing smoke as production delivery would hide route or
  Worker-binding failures.
- Storing raw bodies or attachments before retention/deletion tooling would
  increase privacy and security risk.
- Switching public aliases too early could interrupt verified forwarding for
  security and operations contacts.

## Approval Required

The user has approved creating Cloudflare resources, routing changes, D1/R2,
retention posture, and a new repository for this issue. Public alias migration,
outbound sending, autonomous AI replies, and formal credential rotation remain
separate approval gates.

## Work Packets

- `01-inbox-repo`: implement and verify the dedicated inquiry inbox Worker.
- `02-honowarden-docs`: record implementation state in this repository and add
  guard tests.
- `03-live-smoke-linear-closeout`: verify hidden route production readback,
  merge docs, and close HON-24 in Linear.

## Verification

- Inquiry inbox repo:
  - `pnpm test`
  - `pnpm check`
  - `pnpm lint`
  - `pnpm format`
  - GitHub Actions CI
- HonoWarden repo:
  - `pnpm exec vitest run test/ops/inquiry-inbox-docs.test.ts`
  - broader targeted ops/release docs tests
  - `pnpm format`
  - `pnpm check`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm release:gate -- --strict`
  - `git diff --check`
  - touched-doc secret/email scan
- Cloudflare:
  - staging and production D1 migration readback
  - staging and production Worker health
  - Worker secret-name readback
  - Email Routing rule readback
  - hidden route production D1 row readback after live smoke

## Reusable Artifacts

- `docs/operations/ai-inquiry-inbox.md`
- `docs/operations/website-email.md`
- `docs/current-state.md`
- `test/ops/inquiry-inbox-docs.test.ts`
