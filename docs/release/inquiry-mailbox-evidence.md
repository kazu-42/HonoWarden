# Inquiry Mailbox Evidence

Status: partial.

Mode: metadata-only inbound inquiry mailbox storage for `honowarden.com`.

This file records non-secret evidence for the first AI inquiry inbox
implementation slice. It must not include message bodies, attachment contents,
private forwarding destinations, raw sender values, operator email addresses,
Cloudflare tokens, or Linear API keys.

## Scope

HON-24 implements the minimum inbound mailbox storage path:

- Cloudflare Email Service invokes the Worker `email(message, env, ctx)`
  handler for routed mail.
- The handler accepts only configured `honowarden.com` inquiry local parts.
- D1 table `inquiry_messages` stores envelope sender, recipient, sanitized
  header metadata, hashed subject and message-id values, raw size, delivery
  status, and metadata retention deadline.
- Raw MIME body storage is disabled with `raw_storage_state = 'disabled'`.
- Body parsing is not run; `body_metadata_json` records only storage state,
  parser state, content type, transfer encoding, and raw size.
- Likely attachment-bearing mail is rejected until R2 retention, access, and
  deletion controls exist.
- Persistence failures call `setReject("Temporary inquiry storage failure")`
  and log only structured, secret-safe metadata.

## Local Verification

- `pnpm format`: passed
- `pnpm check`: passed
- `pnpm lint`: passed
- Targeted tests passed:
  `pnpm vitest run test/email-handler.test.ts test/migrations.test.ts test/release-docs.test.ts test/security-docs.test.ts test/scheduled.test.ts test/infra/db-health.test.ts test/wrangler-environments.test.ts`
- Targeted tests after smoke-mailbox config coverage passed on
  `2026-07-09T20:51Z`: 11 files / 61 tests passed.
- `pnpm test`: 100 files / 853 tests passed
- `pnpm compat:test`: 5 files / 112 tests passed
- `pnpm release:gate -- --strict`: `overall = ready`, migration count `9`
- `pnpm brand:scan`: passed
- `git diff --check`: passed

## Live Verification

Status: storage route configured; external SMTP smoke pending.

The intended live smoke uses a dedicated `inquiry-smoke@honowarden.com` Email
Routing rule pointed at the API Worker. Existing `security`, `support`,
`hello`, `admin`, `postmaster`, and `abuse` forwarding routes must remain
unchanged until operator mailbox UI or forwarding behavior is explicitly
validated.

Record only:

- Worker deployment id or version id
- D1 migration readback showing `0009`
- Email Routing rule id for the smoke address, redacted if needed
- subject hash, message-id hash, mailbox, delivery status, storage-state fields,
  and retention deadline from the D1 row
- Cloudflare Email Routing activity status, if available

Do not record the raw subject, body, sender address, or private destination.

Completed live setup:

- Staging D1 migration readback: no migrations to apply after `0006`, `0007`,
  `0008`, and `0009` were applied.
- Production D1 migration readback: no migrations to apply after `0006`,
  `0007`, `0008`, and `0009` were applied.
- Production D1 table readback: `inquiry_messages` exists.
- Production latest migration readback includes `0009`, `0008`, `0007`, and
  `0006`.
- Staging Worker deploy: version `7d58b22c-2cc3-483a-a995-bd6949c98363`.
- Production Worker deploy: version `cc38fe41-2bae-4d88-8bba-c98302a45be3`.
- Post-deploy HTTPS smoke passed:
  - staging `/health`: HTTP `200`
  - staging `/health/db`: HTTP `200`
  - production `/health`: HTTP `200`
  - production `/health/db`: HTTP `200`
  - production `/api/config`: HTTP `200`
- Email Routing rule readback shows the six existing forwarding routes remain
  enabled and redacted.
- Dedicated smoke route:
  - rule id: `68c29c7c281045339f07cb6a4a58d73b`
  - matcher: `inquiry-smoke@honowarden.com`
  - action: `worker`
  - worker: `honowarden`
  - enabled: `true`

Live storage readback as of `2026-07-09T20:51Z`:

- A local unauthenticated `sendmail` attempt did not create a D1 row.
- Direct SMTP from this workstation to Cloudflare MX over TCP port `25` timed
  out, so the agent could not self-generate a public SMTP smoke from the local
  network.
- `wrangler dev --remote` did not expose the local email simulator endpoint;
  `POST /cdn-cgi/handler/email` returned HTTP `404`, so it was not used as
  evidence.
- Production D1 row count for `inquiry_messages`: `0`.
- Production D1 lookup by the expected operator-smoke subject hash returned no
  rows.
- Cloudflare Email Routing activity for the previous seven days still shows
  the earlier six forwarding-route smoke events at `2026-07-09T13:00:00Z`
  (`count: 6`, `action: forward`, `status: delivered`) and no later
  `inquiry-smoke@honowarden.com` event.
- Awaiting one external SMTP message to `inquiry-smoke@honowarden.com`.
- Expected subject hash for the operator-requested smoke message:
  `a1bb2a9ef8bf3f383d31292a4905a29facc1322085f6567f08798ed0bd703919`

## Rollback

If the smoke route breaks inbound delivery:

1. Disable or delete only the `inquiry-smoke@honowarden.com` route rule.
2. Leave the six existing forwarding rules unchanged.
3. Redeploy the previous API Worker version only if the HTTP API health checks
   fail after the email handler deploy.
4. Keep migration `0009`; it is additive and does not affect existing vault
   tables.
