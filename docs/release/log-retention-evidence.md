# Log Retention Evidence

Status: passed.

Mode: external Worker runtime log sink and Cloudflare log-retention access
evidence for `honowarden` and `honowarden-staging`.

This file must not include Cloudflare tokens, R2 access keys, R2 secret keys,
private mailbox destinations, request bodies, response bodies, access tokens,
refresh tokens, passwords, decrypted vault data, encrypted vault payloads, or
raw user-provided secrets.

## Scope

HON-49 uses Cloudflare Workers Trace Events Logpush to ship Worker invocation
metadata, structured console messages, and uncaught exception metadata to a
dedicated R2 bucket. The sink is intentionally Cloudflare R2 rather than a
third-party SaaS so the project can control retention and deletion without
introducing another vendor credential.

Cloudflare documentation verified on `2026-07-09`:

- Workers Logpush sends Workers Trace Event Logs to supported destinations and
  includes request/response metadata, console messages, and uncaught
  exceptions.
- Workers Trace Events Logpush requires Logpush access and can be enabled on a
  Worker with the `logpush` Worker setting.
- R2 Logpush destinations use an `r2://.../{DATE}` destination with R2
  credentials, and `{DATE}` is recommended to keep daily folders.
- Logpush delivers logs in batches and cannot backfill historical data if a job
  is disabled or failing.
- Workers Logs should use structured JSON logging and must avoid secrets.

## Chosen Sink

- Dataset: `workers_trace_events`
- Destination: Cloudflare R2 bucket `honowarden-worker-logpush`
- Prefix: `workers_trace_events/{DATE}`
- Job name: `honowarden-workers-trace-events-to-r2`
- Job ID: `1780267`
- Job state: enabled
- Worker filter:
  - `ScriptName == "honowarden"`
  - `ScriptName == "honowarden-staging"`
- Worker metadata:
  - `honowarden-staging`: `logpush: true`
  - `honowarden`: `logpush: true`
- Wrangler configuration:
  - top-level `logpush: true`
  - staging `logpush: true`
  - production `logpush: true`
  - observability enabled with `head_sampling_rate: 1`

The Logpush `destination_conf` contains R2 credentials and is intentionally not
recorded. Readbacks redact `access-key-id` and `secret-access-key`.

## Fields

The job emits this field set:

- `Event`
- `EventTimestampMs`
- `EventType`
- `Outcome`
- `Exceptions`
- `Logs`
- `ScriptName`
- `ScriptVersion`
- `CPUTimeMs`
- `WallTimeMs`

Rationale:

- keep runtime outcome, event type, script identity, timing, and exception
  metadata for incident review;
- include `Logs` because HonoWarden audit/error logging is structured and
  already secret-filtered by tests;
- do not add request or response body fields;
- keep `HONOWARDEN_AUDIT_LOGS=false` in staging and production until operator
  approval explicitly enables persisted audit events.

## Retention And Access

- Retention target: 35 days for routine Worker runtime logs.
- Access: operator-only Cloudflare account/R2 credentials.
- Delete by date prefix after the retention window unless an incident or legal
  hold explicitly requires preservation.
- Keep D1 `audit_events` retention independent from Logpush R2 retention; D1
  audit rows retain for 365 days when audit logging is enabled.
- Treat Worker logs as sensitive operational metadata even when request bodies
  and known secret fields are absent.

Manual retention action:

```sh
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 rm \
  "s3://honowarden-worker-logpush/workers_trace_events/YYYYMMDD/" \
  --recursive \
  --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
```

Use the exact date prefix returned by R2 object listing. Do not run a broad
bucket delete.

## Live Setup Readback

Completed on `2026-07-09T21:00Z`:

- R2 bucket `honowarden-worker-logpush` created.
- Account-level Logpush job `1780267` created.
- Logpush job readback:
  - dataset: `workers_trace_events`
  - enabled: `true`
  - `last_complete`: `null` immediately after creation
  - `last_error`: `null`
  - `error_message`: `null`
  - destination redacted
- R2 initial object readback shows the Logpush destination verification object:
  `workers_trace_events/00010101/test.txt.gz`
- Worker settings readback:
  - `honowarden-staging`: `logpush: true`, observability enabled
  - `honowarden`: `logpush: true`, observability enabled
- Both Worker settings still include the expected D1/R2 bindings and
  fail-closed `HONOWARDEN_AUDIT_LOGS=false`.

Current job readback after delivery:

- `last_complete`: `2026-07-09T21:07:26Z`
- `last_error`: `null`
- `error_message`: `null`
- destination remains redacted in local evidence

## Smoke Readback

Health smoke requests sent on `2026-07-09T21:01Z`:

- staging:
  `GET https://honowarden-staging.ghive42.workers.dev/health?hon49-logpush-smoke-20260709T2103Z=staging`
  returned HTTP `200`.
- production:
  `GET https://honowarden.ghive42.workers.dev/health?hon49-logpush-smoke-20260709T2103Z=production`
  returned HTTP `200`.

Initial R2 delivery readback:

- R2 objects appeared under `workers_trace_events/20260709/`.
- Health-smoke events were read from these objects:
  - `workers_trace_events/20260709/20260709T210259Z_20260709T210319Z_8d5ff9fb.log.gz`
  - `workers_trace_events/20260709/20260709T210638Z_20260709T210707Z_e26830e6.log.gz`
  - `workers_trace_events/20260709/20260709T210658Z_20260709T210707Z_258995d4.log.gz`
- Parsed Worker events included both `honowarden-staging` and `honowarden`
  fetch events for `/health`, with `Outcome: ok`, no `Exceptions`, and no
  `Logs`.
- Workers Trace Events redacted the query parameter name to `REDACTED`, so the
  original query marker is intentionally not usable as durable smoke evidence.
- Secret-indicator scan over parsed string fields found no bearer token,
  password, token, secret, or access-key patterns.

Path-marker smoke requests sent on `2026-07-09T21:11Z`:

- staging:
  `GET https://honowarden-staging.ghive42.workers.dev/hon49-logpush-smoke-20260709T2111Z/staging`
  returned HTTP `404`.
- production:
  `GET https://honowarden.ghive42.workers.dev/hon49-logpush-smoke-20260709T2111Z/production`
  returned HTTP `404`.

The `404` responses are expected because these marker paths are not application
routes. They still exercise the Worker runtime and produce Logpush fetch events
for the matching Worker hostnames and staging/production scope suffixes.

Completed path-marker delivery readback:

- R2 object:
  `workers_trace_events/20260709/20260709T211217Z_20260709T211231Z_d52e4029.log.gz`
- Parsed events:
  - `honowarden-staging`, `EventType: fetch`, `Outcome: ok`, path
    `/REDACTED/staging`
  - `honowarden`, `EventType: fetch`, `Outcome: ok`, path
    `/REDACTED/production`
- Workers Trace Events also redacted the custom marker path segment. The
  staging/production suffixes, object delivery window, request timing, and
  worker hostnames still prove both Workers delivered runtime events to R2.
- Parsed event readback found no `Exceptions`, no `Logs`, and no bearer token,
  password, token, secret, or access-key indicators.

## Failure Mode

- Application audit persistence remains fail-loud when
  `HONOWARDEN_AUDIT_LOGS=true` and D1 audit writes fail.
- Logpush delivery failure is an operational degradation: Worker requests
  continue, but Cloudflare Logpush job `last_error`, `error_message`, and R2
  object absence must page or block operational closeout.
- Logpush cannot backfill historical data after a disabled or failing period, so
  job health and R2 object freshness are part of the runbook.

## Rollback

If Logpush volume, access, or data sensitivity is unacceptable:

1. Set `logpush: false` on `honowarden` and `honowarden-staging` Worker
   settings or deploy the previous Wrangler configuration.
2. Disable Logpush job `1780267`.
3. Preserve already-written R2 objects until reviewed; do not delete evidence
   during an active incident.
4. If rollback is due to sensitive data in logs, open an incident and review
   `docs/security/incident-response.md` before deleting R2 prefixes.
