# Organization Invitation Delivery

Status: source implementation with synthetic provider tests. No real invitation
delivery, new credential, remote service binding, or deployment is established by
this document. Existing tracked membership and EVP flags remain unchanged.

The vault API already sends committed invitations through
`ORGANIZATION_MEMBERSHIP_MAILER` to the fixed internal `/deliver` destination.
The separate entrypoint `src/organization-invitation-service.ts` connects a
bounded receiver to the Resend sender. It has no database, vault keys, or inquiry
workflow authority. Account lifecycle mail remains a separate integration.

## Message And Failure Contract

The receiver accepts exactly `recipientEmail`, `organizationId`, `membershipId`,
`token`, and `expiresAt` as a JSON body of at most 4,096 bytes. It reuses membership
email/token validation, rejects expired invitations, and constructs a plain-text
message from a fixed subject and configured sender. The link is
`{ADMIN_ORIGIN}/admin/accept/{organizationId}/{membershipId}#token={token}`.
The secret appears only in the fragment, which the administration client removes
from browser history before parsing. Only the authenticated invited recipient
can consume it; acceptance remains single-use and does not replace manager
confirmation or key wrapping.

The sender makes one HTTPS request to Resend, disallows redirects, propagates
the receiver's abort signal, and requires a successful status with a bounded JSON
`id` acknowledgement. The response body limit is 4,096 bytes, including streaming
responses without a length header. Error responses are discarded without reading.
Neither provider responses, recipient addresses, tokens, nor credentials appear
in failure responses or logs. Receiver telemetry contains only the fixed event
and `delivery_failed`, `delivery_rejected`, or `delivery_timeout` code.

The receiver allows ten seconds for the sender, including response parsing.
An abort stops local work; it cannot retract a message already accepted remotely.
No layer automatically retries. HTTP `202` means provider acceptance, not inbox
receipt. The provider id is checked and discarded, not persisted or exposed.

Invitations commit in D1 before outbound delivery. A sender failure preserves the
existing route's `503 invitation_delivery_unavailable`, `persisted: true`, and
membership IDs. Read membership state and intentionally reinvite the affected
invited member. Reinvitation rotates the verifier before sending, so any delayed
old email is unusable. Accepted memberships cannot be reinvited. Do not repeat the
original invitation batch or claim exactly-once inbox delivery.

Identical provider payloads produce the same SHA-256-derived idempotency key;
token rotation changes the key. Resend documents a 24-hour idempotency window,
which is shorter than the invitation's five-day lifetime. That window is a
duplicate-delivery aid, not the token's replay defense. The fixed endpoint,
structured message fields, acknowledgement and idempotency behavior follow the
[Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email),
read on 2026-10-06.

## Isolated Service Configuration

Prepare a separate Worker configuration for review; this example is not applied
to any environment. The internal hostname check is routing validation and is not
authentication. Keep this Worker reachable only through authorized service
bindings, with no public route or preview URL.

```toml
name = "honowarden-organization-invitation-mailer"
main = "src/organization-invitation-service.ts"
compatibility_date = "2026-07-06"
workers_dev = false
preview_urls = false
routes = []

[vars]
HONOWARDEN_INVITATION_ADMIN_ORIGIN = "https://vault.example.test"
HONOWARDEN_INVITATION_SENDER_EMAIL = "invites@example.test"
```

Use the exact approved HTTPS origin, with no path or trailing slash, and a
normalized sender address in the reviewed verified sending domain. These example
values are synthetic. Supply `HONOWARDEN_INVITATION_RESEND_API_KEY` as a separate
secret only to this Worker. It must be dedicated to invitation delivery, with
`sending_access` and a restriction to the chosen sending domain. Resend documents
the permission in [Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key)
and domain restrictions in [Manage API keys](https://resend.com/docs/dashboard/api-keys/introduction),
both read on 2026-10-06. Do not reuse the inquiry reply credential or its
human-approval workflow. Do not add the vault D1, R2, token secrets, or inquiry
database to the invitation Worker.

The vault Worker's environment-specific service binding, prepared separately,
would target that reviewed service:

```toml
[[services]]
binding = "ORGANIZATION_MEMBERSHIP_MAILER"
service = "honowarden-organization-invitation-mailer"
```

No vault `src/app.ts` change is required: the existing binding adapter is already
wired into invitation and reinvitation. `HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED`
and `HONOWARDEN_ORGANIZATION_INVITE_SECRET` remain separate prerequisites. This
packet does not enable either flag or add a live binding.

## Operator Inputs And Runtime Acceptance

Before activation, establish the exact sender/domain, approved admin origin,
dedicated credential scope, receiving test account, and target service/environment.
Read back current sender verification and domain authentication, disabled tracking
and URL rewriting, provider content retention, and service exposure. The mail
provider necessarily receives the recipient and token-bearing message; approval
of this data flow is part of selecting that provider.

Use synthetic data to verify provider acceptance and actual receipt separately,
then follow the link in Brave, verify fragment scrubbing, recipient authentication,
one-winner acceptance, manager confirmation, and shared-item use. Repeat a failed
send followed by reinvitation and show that the older token cannot be consumed.
Observe fixed failure telemetry and the membership state independently; do not
export message bodies, links, or API keys as acceptance evidence.

Rollback removes the invitation service binding or disables membership mutations
through the existing feature flag. Preserve committed memberships and audit
history; outstanding tokens retain their existing expiry and acceptance rules.
The receiver/sender do not implement an outbox, bounce processing, email account
verification fallback, or EVP provider discovery.

## EVP Is Independent

Resend transport does not establish a company's Microsoft EVP issuer or browser
interoperability. The existing EVP implementation remains pinned to its documented
protocol, disabled with an empty issuer registry until delegation, issuer metadata
and keys, the exact browser/origin eligibility, and an actual synthetic signed
proof flow have been verified. Follow [the EVP operator contract](email-verification.md).
No Microsoft issuer, tenant capability, or live browser support is inferred from
an MX record, the sender provider, or local synthetic proofs.
