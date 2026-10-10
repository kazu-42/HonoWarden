# Account lifecycle mail delivery

This source adapter implements the existing `ACCOUNT_LIFECYCLE_MAILER` contract.
It does not enable account lifecycle routes or deploy a mail service. Apply the
organization invitation delivery source first: this adapter reuses its bounded
plain-text Resend transport with a separate credential. EVP issuer configuration,
Microsoft interoperability, and official client acceptance remain separate work.

## Acceptance and authority

The private receiver accepts only `POST https://account-lifecycle-mailer.internal/deliver`
with bounded JSON. Both `deliver` and `suppress` validate, encrypt, and await one
`Queue.send` through the same code path. An empty HTTP 202 means the queue binding
accepted the encrypted message. It does not mean the provider accepted it or a
recipient received it. The receiver has no provider dependency and bounds the
enqueue wait at five seconds. The public account endpoints retain their existing
response contract, including empty HTTP 200 for deletion recovery.

The envelope uses AES-256-GCM, a random 96-bit IV, and authenticated version/key
context. The delivery payload and enqueue timestamp occupy a fixed 2,048-byte
random-padded plaintext block. Purpose, disposition, recipient, account reference,
and code are encrypted. Only version, key ID, IV, and fixed-size ciphertext enter
the queue or its DLQ. The private service has neither vault nor inquiry database
access. The internal URL check is not authentication: private deployment and the
service binding provide the invocation boundary.

The consumer acknowledges suppressed messages without constructing a provider
request, including when sender/provider configuration is missing. Eligible mail
contains a plain-text code and purpose-specific instructions. It invents no
confirmation URL. Deletion mail also includes the account reference required by
the existing logged-out `delete-recover-token` request. That identifier never
appears in the public recovery response or this service's logs. Email verification
requires the signed-in verification form; email change and deletion still require
a client implementing their existing confirmation contract.

## Private Worker and binding configuration

Prepare a separately reviewed target configuration with these settings. Names
below are proposed dedicated resources, not resources created by this change.
This patch leaves all tracked vault feature-flag values unchanged.

```jsonc
{
  "name": "honowarden-account-mail",
  "main": "src/account-lifecycle-mail-service.ts",
  "compatibility_date": "2026-07-06",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "vars": {
    "HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID": "account-mail-1",
    "HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL": "accounts@example.test",
  },
  "queues": {
    "producers": [
      {
        "binding": "ACCOUNT_LIFECYCLE_DELIVERY_QUEUE",
        "queue": "honowarden-account-mail-delivery",
        "delivery_delay": 0,
      },
    ],
    "consumers": [
      {
        "queue": "honowarden-account-mail-delivery",
        "max_batch_size": 10,
        "max_batch_timeout": 1,
        "max_retries": 3,
        "retry_delay": 60,
        "max_concurrency": 1,
        "dead_letter_queue": "honowarden-account-mail-delivery-dlq",
      },
    ],
  },
}
```

Do not inherit routes, custom domains, previews, assets, cron triggers, DB/R2
bindings, inquiry secrets, or vault secrets into this Worker. Before any activation,
read back those properties and verify only the intended vault Worker can invoke
the service. In the separately reviewed vault target configuration, bind
`ACCOUNT_LIFECYCLE_MAILER` to service `honowarden-account-mail`. Keep
`HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED` off in the company-use/production target
until runtime acceptance is complete. Exercising the actual API requires a
separately authorized, scoped activation in an isolated synthetic test target;
that target must exclude real vaults and recipients. Keep the tracked default
off. This document does not authorize or perform either activation.

Supply these values privately, never through a committed configuration:

| Secret                                    | Contract                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS` | JSON object mapping the active key ID and at most two previous IDs to independently generated 32-byte AES keys, canonical unpadded base64url. |
| `HONOWARDEN_ACCOUNT_MAIL_RESEND_API_KEY`  | A separate account-mail-only Resend key, with sending-only permission restricted to the approved sender domain.                               |

The nonsecret active key ID must exist in the keyring. The sender must be a
normalized mailbox on the approved, currently verified domain. Do not reuse token
signing, TOTP, invitation-mail, inquiry, or provider credentials as encryption
keys; do not reuse the invitation/inquiry sending key. The earlier inquiry
deployment does not establish current authorization or provider configuration.
See Resend's [sending permissions](https://resend.com/docs/api-reference/api-keys/create-api-key)
and [domain-scoped keys](https://resend.com/docs/dashboard/api-keys/introduction).

## Retention, retries, and recovery

This design requires explicit **86,400-second retention for both the main queue
and its DLQ**, with no automatic DLQ consumer. Retention is a queue-level setting,
not a field invented in the Worker configuration. The reviewed operator action
must set/read back `--message-retention-period-secs 86400` for each queue. No such
action has run in this source task. The configuration documentation describes a
four-day generic default, while the plan limits page specifies 24 hours on Free;
an actual account's settings must be read back instead of inferred from defaults.
See [queue configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/),
[queue CLI settings](https://developers.cloudflare.com/queues/reference/wrangler-commands/),
and [plan limits](https://developers.cloudflare.com/queues/platform/limits/).

The consumer rejects batches above 10, sends sequentially with a 10-second
provider timeout, and explicitly acknowledges each success. A retryable failure
requests redelivery after 60 seconds; the configuration caps retries at three
before the encrypted envelope goes to the DLQ. Individual acknowledgements
survive later batch failures. These settings use Cloudflare's documented
[acknowledgement/retry model](https://developers.cloudflare.com/queues/configuration/batching-retries/)
and [dead-letter routing](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
Keep batch size, retry limit, retry delay, concurrency, retention, and DLQ target
in the runtime readback; code cannot enforce cloud retry counts or retention.

Structurally invalid messages are acknowledged with a fixed `message_invalid`
event, so an accidental plaintext poison message is not copied into the DLQ.
Unknown keys or failed authentication are retried with `message_unreadable` to
allow recovery from configuration mistakes. Provider errors produce only
`delivery_failed`; response bodies, exception strings, addresses, account IDs,
codes, and keys are never logged. Expired decoded messages are acknowledged
without sending. Inspect aggregate failure counts and queue age/depth; do not
export queue payloads or decrypted mail to incident artifacts.

Rotate by adding a new independent key and selecting its ID, while retaining
keys for messages still in either queue. The keyring permits an active key plus
two previous keys: do not rotate faster than both main-queue and DLQ drainage or
confirmed expiry permits. Never reuse a key ID with different material. A DLQ
residency can follow main-queue residency, so a single retention interval alone
does not prove a key is disposable. Keep necessary keys until the actual queues
are drained, or all affected messages are intentionally expired/discarded under
the reviewed recovery procedure. Do not automatically replay a DLQ. Any approved
replay retains the original envelope; expired codes remain unsendable.

This is at-least-once delivery. The Resend transport hashes the complete fixed
mail payload for its idempotency key; retrying the same envelope produces the
same body/key. Its existing `honowarden-invitation:` namespace is retained as a
transport implementation detail. Resend documents a 24-hour idempotency window;
it does not promise exactly-once inbox delivery. Keep sender configuration stable
while draining retries, because changing `from` changes that digest. See
[Resend send and idempotency](https://resend.com/docs/api-reference/emails/send-email).

Queue send has no cancellation API. If its result is lost or arrives after the
five-second timeout, the receiver returns 503 although the message may already
be queued. The existing vault path then marks the reservation failed/superseded;
a late email can contain an unusable code. Reissuing a code can similarly leave
older queued mail. The consumer has no DB lookup and does not undo either state.
The backend's existing reservation, expiry, generation, and single-use checks
remain authoritative. A provider can likewise accept a send before a response
is lost; bounded queue retry and idempotency mitigate that ambiguity without
claiming exactly-once delivery.

Rollback keeps the account lifecycle flag off, stops new producers, and pauses
consumer delivery under a reviewed operational action while preserving encrypted
queues and their keys. Do not revert to synchronous sending or discard keys to
silence failures. Resolve configuration or intentionally expire remaining work
before removing resources.

## Evidence before company activation

Source tests prove encrypted roundtrip/tamper handling, equal-size deliver and
suppress envelopes, deferred 202 until queue acceptance, fixed errors, timeout
cancellation, suppression without provider access, expiry, poison handling,
stable retry body/idempotency key, and native Worker/Queue type compatibility.
They use synthetic keys, a queue fake, and injected/stubbed provider fetch.

These tests do not prove Cloudflare durability, cloud retry/DLQ behavior, actual
provider acceptance/receipt, or known/unknown account latency equivalence. The
existing public endpoint still performs account lookup and conditional D1
reservation. Collect interleaved known/unknown synthetic requests at the actual
public endpoint with response/status/body and timing distributions under normal
and failing queue conditions. Do not treat a same-path unit test as an enumeration
resistance benchmark. Also verify signed-in email confirmation/replay rejection,
logged-out deletion confirmation data, key rotation with queued messages, and
private route/binding/retention readback before enabling company use.
