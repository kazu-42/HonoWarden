# ADR 0013: Hosted Billing, Licensing, Provider, And Tenancy Boundary

## Status

Accepted

## Context

Official clients call a small billing-shaped surface during self-hosted
startup. The pinned Android smoke reads
`GET /api/account/billing/vnext/subscription` after login. Account profile and
sync also carry `premium`, `premiumFromOrganization`, `providers`, and
`providerOrganizations`. Server config reports `environment.cloudRegion`.

Those startup reads are not a commercial cloud. Upstream hosted APIs also
include Stripe checkout, payment methods, invoices, tax preview, credit,
customer-portal sessions, paid seat changes, license file issue/sync, MSP
provider/reseller portals, Families-for-Enterprise sponsorships, and
multi-tenant hosted operation. The upstream OpenAPI inventory used for this
decision is the public protocol API binding generated from server commit
`f758b982f8b89e8e16b3cd5f56fc129b30b45035`.

HonoWarden is an independent, API-only self-hosted vault sync Worker. It is not
a payment processor, not a license authority, and not a hosted multi-tenant
SaaS. ADR 0001 already excludes hosted multi-tenant operation. ADR 0009 already
keeps premium-gated product surfaces explicit. `HONOWARDEN_PREMIUM_FEATURES_ENABLED`
is an operator capability switch for TOTP and cipher-scoped attachments, not a
paid entitlement.

Implementing any of the commercial surfaces would add payment/compliance
burden (card data, tax, invoices, support contracts), tenant isolation across
unrelated paying customers, and a false affiliation with any upstream hosted
billing vendor. That work does not belong in this product line.

## Inventory

| Surface                                                                                                                                             | Class                   | Decision  | Client-visible behavior                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/account/billing/vnext/subscription`                                                                                                       | official-client startup | implement | Authenticated zero-cost canceled cart. `status: "canceled"`, seat `quantity: 0`, `cost: 0`, `nextCharge: null`, `storage: null`, `secretsManager: null`. Cannot imply an active paid subscription, entitlement, or hosted support contract, including when premium features are enabled. |
| `GET /api/config` `cloudRegion`                                                                                                                     | official-client startup | implement | Always `self-hosted`.                                                                                                                                                                                                                                                                    |
| Profile/sync `premium`                                                                                                                              | official-client startup | implement | Operator flag `HONOWARDEN_PREMIUM_FEATURES_ENABLED` only. Not derived from billing.                                                                                                                                                                                                      |
| Profile/sync `premiumFromOrganization`                                                                                                              | official-client startup | implement | Always `false`.                                                                                                                                                                                                                                                                          |
| Profile/sync `providers`, `providerOrganizations`                                                                                                   | official-client startup | implement | Always empty arrays.                                                                                                                                                                                                                                                                     |
| Organization `billingEmail` / `planType`                                                                                                            | team-vault metadata     | implement | Opaque org fields from ADR 0010. Not a paid plan, seat contract, or license.                                                                                                                                                                                                             |
| Other `/api/account/billing/vnext/*` (checkout, portal, payment-method, credit, license, discounts, reinstate, storage, upgrade, self-host license) | commercial cloud        | reject    | State-free HTTP `501` `unsupported_feature` before authentication, D1, R2, or payment work.                                                                                                                                                                                              |
| `/api/accounts/subscription`, `/api/accounts/billing/*`, `POST /api/accounts/license`, `POST /api/accounts/cancel`                                  | commercial cloud        | reject    | Same `501` contract.                                                                                                                                                                                                                                                                     |
| `/api/licenses`, `/api/licenses/*`, `/api/organizations/licenses`, `/api/organizations/:id/license`                                                 | commercial cloud        | reject    | Same `501` contract. HonoWarden will not ingest or issue commercial license files.                                                                                                                                                                                                       |
| `/api/plans`, `/api/plans/*`                                                                                                                        | commercial cloud        | reject    | Same `501` contract.                                                                                                                                                                                                                                                                     |
| `/api/organizations/:id/billing`, `/api/organizations/:id/billing/*`, `/api/organizations/:id/subscription`                                         | commercial cloud        | reject    | Same `501` contract, not the generic organization alpha catch-all.                                                                                                                                                                                                                       |
| `/api/providers`, `/api/providers/*`                                                                                                                | commercial cloud        | reject    | Same `501` contract. Provider/reseller portals are hosted MSP tenancy.                                                                                                                                                                                                                   |
| `/api/organization/sponsorship`, `/api/organization/sponsorship/*`                                                                                  | commercial cloud        | reject    | Same `501` contract. Sponsorships require an upstream hosted billing relationship.                                                                                                                                                                                                       |
| `/api/billing`, `/api/billing/*`                                                                                                                    | commercial cloud        | reject    | Same `501` contract. Includes invoice/tax preview.                                                                                                                                                                                                                                       |
| Paid seats, invoices, tax, credit, and customer portal                                                                                              | commercial cloud        | reject    | No runtime, secrets, or schema.                                                                                                                                                                                                                                                          |
| Multi-tenant hosted operation                                                                                                                       | commercial cloud        | reject    | One Worker deployment remains one operator's allowlisted users. Unrelated paying tenants are out of scope.                                                                                                                                                                               |
| Operator membership or storage caps as local policy                                                                                                 | not billing             | defer     | If needed, that is organization policy (ADR 0006), not a subscription.                                                                                                                                                                                                                   |
| A future HonoWarden-hosted product                                                                                                                  | new product line        | defer     | Requires a new ADR plus security/compliance-gated children before any implementation.                                                                                                                                                                                                    |

## Decision

Keep official-client startup compatibility truthful and unpaid. Reject hosted
billing, licensing, provider/reseller portals, sponsorships, and multi-tenant
hosted operation for this product line.

1. **Implement** only the existing startup compatibility responses listed
   above. Do not add Stripe, BitPay, PayPal, Braintree, license verification,
   seat commerce, or tenant routing.
2. **Reject** every inventoried hosted-only commerce family with the ADR 0009
   client-readable `501` body, including a top-level `Message`, and
   `Cache-Control: no-store`. Do not return `404` for these families: that
   would look like an accidental missing route.
3. **Defer** local operator caps to policy work, and defer any hosted-SaaS
   reconsideration to a new product-line ADR. This slice creates no
   implementation children.

Rejected routes return this contract before authentication, database, object
storage, or payment work:

```json
{
  "Message": "This feature is unavailable on this server.",
  "error": {
    "code": "unsupported_feature",
    "message": "This feature is unavailable on this server."
  },
  "requestId": "request-id"
}
```

Zero-cost startup compatibility responses cannot imply an active paid
subscription, entitlement, or hosted support contract.

Any later accepted multi-tenant or billing work must be decomposed into new
security/compliance-gated children before implementation. Those children would
have to cover tenant isolation, payment compliance, legal/support ownership,
secret handling, rollback, and live evidence. Until that happens, no billing or
tenancy runtime may be added.

## Consequences

- Android and other official clients can complete self-hosted startup without a
  paid-looking subscription object.
- Checkout, license upload, provider portals, and sponsorships fail explicitly.
- Compatibility docs must not claim hosted billing, licensing, provider, or
  multi-tenant support.
- Reverting this decision requires a replacement ADR and new gated children; it
  requires no data migration because the rejected surfaces persist no state.
