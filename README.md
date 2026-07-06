# HonoWarden

A minimal, API-only encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2.

HonoWarden focuses on personal and small-team vault sync using official clients for the upstream encrypted-vault protocol. It intentionally avoids Web Vault, public registration, organization features, and public file-sharing features in the initial scope to reduce attack surface.

## Status

HonoWarden is pre-alpha. It is not ready to store real secrets, and it has not had an independent security review.

The first milestone is a narrow compatibility target:

- official upstream clients can authenticate against a self-hosted endpoint
- personal vault items can sync through the public client API surface needed for single-user and small-team use
- encrypted vault data is stored in D1, with larger binary objects stored in R2 when required
- server-side behavior stays API-only, with no bundled Web Vault

## Non-Goals

- hosted multi-tenant service
- public account registration
- organization features
- public file sharing
- Web Vault
- browser extension or mobile client forks

## Development

Prerequisites:

- Node.js 22 or newer
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
```

Apply local D1 migrations:

```sh
pnpm db:migrate:local
```

Run locally with Wrangler:

```sh
pnpm dev
```

Generate Cloudflare binding types after editing `wrangler.jsonc`:

```sh
pnpm cf:typegen
```

## Cloudflare Resources

The repository includes placeholder D1 and R2 bindings in `wrangler.jsonc`. Before deploying, create real resources and replace the placeholder IDs/names:

```sh
pnpm wrangler d1 create honowarden
pnpm wrangler r2 bucket create honowarden-vault-objects
```

Local development uses Wrangler's local D1 store. After applying migrations, `GET /health/db` reports the active schema version and required table set.

## Compatibility

Compatibility work is tracked in [docs/compatibility.md](docs/compatibility.md). HonoWarden aims to be protocol-compatible where needed by official upstream clients, not feature-equivalent with the upstream hosted server.

The project roadmap is tracked in [ROADMAP.md](ROADMAP.md). The development approach is incremental: every week should end with a deployable build that is more useful than the week before.

HonoWarden is an independent project and is not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.

## Security

Please do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md) for the current disclosure process.

## License

HonoWarden is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
