# InterX hosting preparation

Status: storage, queues and email domain provisioned; Workers and public origin not yet deployed. Requested 2026-10-21 for ten users requiring Web, macOS Desktop and Windows Desktop.

## Target and isolation

- Public origin: `https://honowarden.interx.co.jp`.
- DNS zone: `interx.co.jp`; authenticated API readback confirms an active zone owned by InterX.
- Expected account SHA-256 from the existing InterX local account configuration: `3f641d358e0972f1644ced98730b4d808da031fb3d51285364a77af74f8865b5`.
- This account differs from the existing gHive release account. Preserve both existing gHive environments and data.
- Build a separate installation with fresh runtime secrets and storage. Do not copy staging users, test vault data, or encryption secrets into the company installation.
- Candidate isolated resource names: Worker `honowarden-interx`, D1 `honowarden-interx` and `honowarden-interx-inquiry`, R2 `honowarden-interx-vault-objects`, private mailers `honowarden-interx-invitation-mailer` and `honowarden-interx-account-mailer`, queues `honowarden-interx-account-mail` and `honowarden-interx-account-mail-dlq`.
- Both D1 databases, the R2 bucket and both queues were created after collision checks and read back on 2026-10-21. Exact database IDs are pinned in Wrangler and the release executor. Workers are not yet created. Private provisioning intent/result receipts are retained under the operator configuration directory.

## Administrator credential preparation

The user explicitly authorized the global API key for this InterX setup. The executor accepts that credential format only with the explicitly pinned `interx` target; staging and production still require their existing scoped token. A dedicated mode-0600 credential file was created without modifying the original InterX credentials or the gHive release credentials. Its values must never be printed or included in evidence.

Provisioning and release require the selected product permissions for Workers Scripts edit, D1 edit, Workers R2 Storage edit, Queues edit, account settings read, zone read, and Workers Routes edit. Add DNS edit only for explicit DNS configuration work. Confirm current permission names in the dashboard; Cloudflare documents both Edit and Write terminology. Email sender/domain setup may require separate email-product permissions; do not silently widen a deployment token or modify the company's existing MX records. R2 backup object access must be verified separately from bucket management.

For future routine operations, prefer an InterX-scoped token with a bounded expiration. The scoped format supported at `~/.config/honowarden/cloudflare-interx-release.env` is:

```dotenv
CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN=<InterX-scoped-user-api-token>
CLOUDFLARE_ACCOUNT_ID=<InterX-account-id>
```

The explicitly authorized global format instead contains exactly `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL`. Never mix credential formats. Back up an existing destination and compare its hash before changing it. The executor strips ambient authentication and verifies the pinned account before effects.

References: [Cloudflare token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Workers authorization](https://developers.cloudflare.com/workers/authorization/).

## Required implementation and execution

1. Account hash, account display name and zone ownership have been verified. The exact public hostname had no DNS records before provisioning; recheck before attaching the Worker.
2. The explicitly pinned InterX release target and global authentication boundary are implemented with regression tests. Existing staging/production identity pins remain unchanged. First-vault deployment still needs an explicit safe bootstrap path.
3. D1/R2/queues are provisioned with durable create/readback receipts. Exact IDs, service bindings, mail origin and a company feature profile are configured. Tracked writer defaults remain off. The new `initialize-db` command requires InterX, exact confirmation, a clean pinned commit, an absent Worker and a completely empty DB including absence of the migration ledger. It records a Time Travel bookmark, applies migrations and verifies full schema/FK integrity; ambiguous failure requires inspection before any retry.
4. The InterX sending domain `honowarden.interx.co.jp` is enabled. Cloudflare automatically created six DNS records; MX trailing-dot and TXT quote normalization confirms all match the expected records. No separate DNS overwrite was performed. The company's apex MX records were not modified. Actual email receipt remains unverified.
5. Run relevant release regressions, full checks and build. Pin the reviewed commit and module hash. Apply schema, deploy private mailers, upload the vault candidate, then activate through the release executor with exact target confirmation.
6. Bind the exact hostname as a Worker Custom Domain only after checking for conflicts. Preserve other InterX DNS records. Verify TLS, API/config URLs, admin assets, and notification endpoints. Provide a deliberate entrypoint for `/`; the current root returns API metadata and the admin UI is at `/admin/`.
7. Open initial setup only for the bounded owner bootstrap, then close it and verify closure. The real owner and nine additional recipients are not yet provided; do not invent addresses or send invitations to arbitrary people.
8. Prove scheduled D1/R2 backup plus isolated application recovery; complete real email receipt, separate-member sharing/decryption, revocation, and required Web/macOS/Windows checks before admitting company secrets.

## Recovery and acceptance

Keep predecessor versions and export evidence before any change to an existing target. For a new target, close setup and remove its traffic binding if acceptance fails, while preserving storage and diagnostic receipts. Do not delete a database or restore over live data as an automatic rollback. A successful DNS/TLS check is not company-use acceptance.

Billing acceptance must identify the InterX account and product usage. Keep gHive and InterX usage separate in the published inventory; account display names do not prove the legal billing entity or payment method.
