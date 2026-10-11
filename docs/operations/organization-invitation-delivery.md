# Organization Invitation Delivery

Status: source implementation with synthetic provider tests. No real invitation
delivery, new credential, remote service binding, or deployment is established by
this document. Existing tracked membership and EVP flags remain unchanged.

The vault API already sends committed invitations through
`ORGANIZATION_MEMBERSHIP_MAILER` to the fixed internal `/deliver` destination.
The separate entrypoint `src/organization-invitation-service.ts` connects a
bounded receiver to the Cloudflare Email Service sender. It has no database, vault keys, or inquiry
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

The sender calls the native `EMAIL.send` binding once with a single recipient and
plain text. It requires a nonempty, control-free `messageId` of at most 512
characters and discards it. Provider errors are sanitized; telemetry contains
only a documented Cloudflare error code or `unknown`, `timeout`, or `invalid_ack`.
Neither provider text, recipient addresses, tokens, nor message bodies appear in
failure responses or logs. Receiver telemetry contains only its fixed event and
`delivery_failed`, `delivery_rejected`, or `delivery_timeout` code.

The receiver allows ten seconds for the sender, including provider acknowledgement.
An abort stops local waiting; it cannot retract a message already accepted remotely.
No layer automatically retries. HTTP `202` means provider acceptance, not inbox
receipt. The provider message ID is checked and discarded, not persisted or exposed.

Invitations commit in D1 before outbound delivery. A sender failure preserves the
existing route's `503 invitation_delivery_unavailable`, `persisted: true`, and
membership IDs. Read membership state and intentionally reinvite the affected
invited member. Reinvitation rotates the verifier before sending, so any delayed
old email is unusable. Accepted memberships cannot be reinvited. Do not repeat the
original invitation batch or claim exactly-once inbox delivery.

Cloudflare Email Service has no idempotency key. Invitations still have no
automatic retry. A later manual reinvitation rotates the token; a delayed old
message remains unusable. Provider acceptance is not mailbox receipt.

## Isolated Service Configuration

The tracked `wrangler.invitation-mailer.jsonc` defines local, staging, and
production Workers. It is not applied
to any environment. The internal hostname check is routing validation and is not
authentication. Keep this Worker reachable only through authorized service
bindings, with no public route or preview URL.

Local `example.test` values are synthetic. Staging uses
`no-reply-staging@mail.honowarden.com` and `https://vault-staging.honowarden.com`;
production uses `no-reply@mail.honowarden.com` and
`https://vault.honowarden.com`. Each `EMAIL` binding allows only its configured
sender. The Worker has no vault D1, R2, token secrets, or inquiry database.

The tracked vault `wrangler.jsonc` binds staging to
`honowarden-invitation-mailer-staging` and production to
`honowarden-invitation-mailer`.

No vault `src/app.ts` change is required: the existing binding adapter is already
wired into invitation and reinvitation. `HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED`
and `HONOWARDEN_ORGANIZATION_INVITE_SECRET` remain separate prerequisites. This
packet does not enable either flag or deploy a live binding.

## Operator Inputs And Runtime Acceptance

Cloudflare Email Service is beta and requires Workers Paid for arbitrary recipients.
Onboard `mail.honowarden.com` in the dashboard before deployment. Onboarding
creates cf-bounce MX/SPF/DKIM and DMARC records under that subdomain; leave apex
Email Routing MX/SPF, Resend `send.` records, and apex `_dmarc` untouched. New
domains default to Email preview ON: turn it OFF before sending token-bearing
mail, since preview otherwise retains message bodies in dashboard activity for
about a week. Read back sender verification, subdomain DNS, preview state, and
private service exposure. Cloudflare receives the recipient and token-bearing
message.

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

Cloudflare email transport does not establish a company's Microsoft EVP issuer or browser
interoperability. The existing EVP implementation remains pinned to its documented
protocol, disabled with an empty issuer registry until delegation, issuer metadata
and keys, the exact browser/origin eligibility, and an actual synthetic signed
proof flow have been verified. Follow [the EVP operator contract](email-verification.md).
No Microsoft issuer, tenant capability, or live browser support is inferred from
an MX record, the sender provider, or local synthetic proofs.
