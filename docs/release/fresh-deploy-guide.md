# Fresh deployment preparation

Target: `v0.1.0-alpha`.

Last updated: 2026-09-01.

Status: **REAL WORKER/VERSION/TRAFFIC WRITE STOP**.

This guide prepares and reviews a fresh HonoWarden release locally. It does not
authorize or provide commands for Cloudflare identity selection, resource
creation, secret provisioning, remote migration, first Worker bootstrap,
version upload, traffic activation, or recovery.

## Local preparation

Use Node.js 22.13 or newer and pnpm 11 or newer. Keep real vault data and
credentials out of the checkout.

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level low
pnpm check
pnpm lint
pnpm test
pnpm compat:test
pnpm format
pnpm brand:scan
pnpm release:gate -- --strict
```

The default Wrangler scope is permanently local-only:

- Worker name: `honowarden-local`;
- D1 names: `honowarden-local` and `honowarden-inquiry-local`;
- R2 name: `honowarden-local-vault-objects`;
- D1 IDs are non-production sentinels;
- `workers_dev` and preview URLs are disabled.

Do not replace the sentinel IDs with remote IDs. Real resource identities live
only under the explicit staging and production environment scopes.

Local database setup uses the `DB` binding:

```sh
pnpm db:migrate:local
```

## Fresh remote deployment boundary

Fresh remote deployment remains STOP even when scoped credentials exist or an
operator approves the product intent. The repository's `deploy` and
`staging:dry-run` entrypoints are static blockers and must not receive
credentials. Direct Wrangler invocation is not an approved fallback.

A future reviewed execution packet must bind all of these before any write:

1. exact Cloudflare account and explicit staging or production environment;
2. the scoped credential and its verified permissions;
3. D1, R2, Worker, route, and custom-domain target identities;
4. the complete migration-freeze ledger, including `0018_text_sends.sql` and
   `0020_personal_api_keys.sql` and `0021_emergency_access.sql`;
5. secret names and a stdin-only provisioning mechanism;
6. pre-write readback and per-operation authority;
7. partial-success classification and recovery for resource, secret, migration,
   upload, traffic, and non-versioned setting mutations;
8. an exact reviewed source SHA and trusted build boundary;
9. separate staging and production decisions.

No resource, secret, or migration write may be performed merely to get closer
to the first Worker deployment. A STOP before Worker upload does not recover
earlier partial remote mutations.

## Acceptance after a separately authorized deployment

The following is a readback checklist, not deployment authority:

- exact deployment and traffic identity;
- `GET /health`;
- `GET /healthz`;
- `GET /health/db`;
- `GET /api/config`;
- `POST /identity/accounts/prelogin` with an allowlisted synthetic email;
- authorized synthetic login and sync through a pinned official client.

`/health` and `/healthz` must report the intended environment, a distinct
`workerVersionId`, a canonical `createdAt`, and `build.gitSha` equal to
the exact reviewed commit. `/api/config.gitHash` must equal the same SHA.
Missing or mismatched provenance is STOP.

Database health must prove the intended target and complete migration state.
Text Send remains source-only: `/api/sends*` and `send_access` stay explicit
`501`, `send-enabled` stays false, and no capability keyring is provisioned
by this guide.

## Evidence to preserve

- reviewed full commit SHA and exact-head test results;
- CI run URL for that same SHA;
- toolchain versions;
- account and environment identity with secrets removed;
- D1/R2/Worker/route identities;
- migration versions and required table/index readback;
- traffic and non-versioned settings before and after each authorized write;
- health/config/DB responses with sensitive values removed;
- synthetic smoke results;
- recovery target, authority, and independent readback;
- explicit classification of any partial success.

Until a future execution protocol satisfies those requirements, the release
can be locally prepared and reviewed but not deployed from this repository.
