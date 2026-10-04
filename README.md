# HonoWarden

A minimal encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2, with an optional organization administration interface.

HonoWarden focuses on personal and incrementally verified small-team vault sync using official clients for the upstream encrypted-vault protocol. The source includes encrypted organization sharing, invitations and confirmation, Owner/Admin/User roles, direct and group collection grants, a required-TOTP policy, and a bounded organization audit API. The original browser interface at `/admin/` manages these organization functions; official clients remain the vault item interface. Management and browser-serving flags stay off in tracked configuration. Source implementation and local tests do not establish deployed readiness or complete official-client compatibility.

## Status

HonoWarden is pre-alpha. It is not ready to store real secrets, and it has not had an independent security review.

The first milestone is a narrow compatibility target:

- official upstream clients can authenticate against a self-hosted endpoint
- personal vault items can sync through the public client API surface needed for single-user and small-team use
- encrypted vault data is stored in D1, with larger binary objects stored in R2 when required
- optional browser organization administration, with account keys held in a dedicated crypto worker and no persistent browser credentials

## Non-Goals

- hosted multi-tenant service
- hosted billing, paid subscriptions, and seat commerce
- commercial licensing and provider/reseller portals
- public account registration
- custom roles, SSO/SCIM, enterprise account recovery, and general enterprise policy parity
- public file sharing
- a full personal Web Vault
- browser extension or mobile client forks

## Development

Prerequisites:

- Node.js 22.13 or newer
- pnpm 11 or newer
- a Cloudflare account for deployed Workers, D1, and R2 resources

Install dependencies:

```sh
pnpm install
```

Run checks:

```sh
pnpm check
pnpm lint
pnpm test
pnpm admin:build
```

Apply local D1 migrations:

```sh
pnpm db:migrate:local
```

Run locally with Wrangler:

```sh
pnpm dev
```

Build the administration assets with `pnpm admin:build` before local Worker
startup. `pnpm admin:dev` serves the browser source on loopback port 5173 and
proxies `/api` and `/identity` to the local Worker on port 8787. Configure the
local feature profile and invitation mailer before exercising management;
see [company administration](docs/operations/company-administration.md).
The browser has no public registration flow and keeps unlocked secrets only in
memory. Reloading or closing it requires a new login.

Configure local prelogin allowlist in `wrangler.jsonc` before testing login-related endpoints:

```json
"HONOWARDEN_ALLOWED_EMAILS": "person@example.test"
```

Bootstrap account creation is disabled by default. For local operator testing, set `HONOWARDEN_BOOTSTRAP_ENABLED=true` and provide `HONOWARDEN_BOOTSTRAP_TOKEN` through local environment or Wrangler secrets. Do not commit real bootstrap tokens.

Password grant token exchange requires `HONOWARDEN_TOKEN_SECRET`. Set it through local environment or Wrangler secrets; do not commit real token secrets.

TOTP setup and login require `HONOWARDEN_TOTP_SECRET` to wrap authenticator secrets before they are stored in D1. Set it through local environment or Wrangler secrets; do not put it in `wrangler.jsonc` vars.

Audit JSON lines are opt-in through `HONOWARDEN_AUDIT_LOGS=true`. See [docs/operations/audit-events.md](docs/operations/audit-events.md) for the event contract and secret-safety rules.

Optional browser-assisted email verification is implemented as a strict
relying-party subset of the individual Internet-Draft
`draft-hardt-email-verification-02`, not an RFC. An already authenticated account
can request a challenge and submit an issuer and holder proof for its current
email. Proof is bound to the current session family, device, security stamp,
origin, and expiring nonce; verification metadata and required audit commit
atomically. It does not grant login, MFA assurance, organization privileges,
account recovery, or vault-key authority. Tracked configuration keeps
`HONOWARDEN_EMAIL_VERIFICATION_ENABLED=false`, RP origin empty, and the reviewed
issuer registry empty. Local source and synthetic tests do not prove real
browser/issuer interoperability or deployment. See the
[compatibility boundary](docs/compatibility-inventory.md#email-verification-source-boundary),
[ADR 0017](docs/adr/0017-email-verification-protocol.md), and the
[operator contract](docs/operations/email-verification.md).

Transient auth-defense cleanup runs in bounded slices on password-grant traffic.
See [docs/operations/retention-cleanup.md](docs/operations/retention-cleanup.md)
for retention rules and remaining scheduler work.

Backup and restore planning commands are available for operator drills:

```sh
pnpm backup:export -- --out backups/example --database honowarden --bucket honowarden-vault-objects --mode local
pnpm backup:restore -- --from backups/example --database honowarden-restore --bucket honowarden-restore-vault-objects --mode local
```

They are dry-run by default. Remote R2 backups can add `--r2-list` to discover
object keys through the S3-compatible R2 API before planning object downloads.
See [docs/operations/backup-restore.md](docs/operations/backup-restore.md)
before using `--execute`.

Generate Cloudflare binding types after editing `wrangler.jsonc`:

```sh
pnpm cf:typegen
```

## Cloudflare Resources

The top-level `wrangler.jsonc` bindings identify local resources. Remote
bootstrap and deployment are currently stopped. Resource creation, migration,
and runtime configuration require the separately reviewed execution protocol
described in [Deploy Provenance](docs/operations/deploy-provenance-runbook.md).

Local development uses Wrangler's local D1 store. After applying migrations,
`GET /health/db` reports the latest recorded migration and required tables.
It does not verify columns, indexes, triggers, or an exact migration manifest;
this source requires all tracked migrations through 0031 even when management
flags are off.
The default-off email-verification route guard performs no challenge-table work;
it does not replace the complete schema-first rollout contract.

## Compatibility

Compatibility work is tracked in [docs/compatibility.md](docs/compatibility.md). HonoWarden aims to be protocol-compatible where needed by official upstream clients, not feature-equivalent with the upstream hosted server.

The project roadmap is tracked in [ROADMAP.md](ROADMAP.md). The development approach is incremental: every week should end with a deployable build that is more useful than the week before.

Release readiness materials live in [docs/release/index.md](docs/release/index.md).

Linear tracking setup is documented in [docs/operations/linear-tracking.md](docs/operations/linear-tracking.md).

Local operator environment setup is documented in [docs/operations/operator-environment.md](docs/operations/operator-environment.md).

Website and email operations are organized in [docs/operations/website-email.md](docs/operations/website-email.md).
Email Routing preflight is available with `pnpm email:preflight`.
The active operator queue, redaction-first AI triage, approval-gated replies,
and duplicate-safe Linear workflow run in the separately deployed
[`HonoWarden-inquiry-inbox`](https://github.com/kazu-42/HonoWarden-inquiry-inbox)
service; raw MIME retention and autonomous actions remain disabled.

HonoWarden is an independent project and is not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.

## Security

Please do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md) for the current disclosure process.

## License

HonoWarden is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
