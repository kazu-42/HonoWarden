# Official Client Endpoints

This runbook defines the stable HonoWarden origins used by official upstream
clients. Keep the public website and vault API on separate hostnames.

This is the source routing contract. It does not record production login
completion.

## Supported Server URLs

| Environment | Server URL                             | Use                                      |
| ----------- | -------------------------------------- | ---------------------------------------- |
| production  | `https://vault.honowarden.com`         | Explicitly authorized production clients |
| staging     | `https://vault-staging.honowarden.com` | Synthetic accounts and client evidence   |

`https://honowarden.com` is the public website. It is not an official-client
**Server URL**: the website does not serve `/api/config`, identity, sync, or
notification APIs. Do not enter the website apex in an official client.

Tracked Wrangler config keeps `workers_dev` and per-version preview URLs
disabled in every scope. The two Custom Domains above are the documented public
Worker entry points for staging and production.

## Client Setup

In Desktop, select **Accessing: Self-hosted**, enter the environment's complete
Server URL, and save it before entering an email address. Browser extension and
mobile clients use the equivalent self-hosted environment selector.

Before providing credentials, verify the exact origin:

```sh
BASE="https://vault-staging.honowarden.com"

curl -fsS "$BASE/health"
curl -fsS "$BASE/healthz"
curl -fsS "$BASE/health/db"
curl -fsS "$BASE/api/config"
curl -sS -o /tmp/honowarden-prelogin.json -w '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' \
  --data '{"email":"nobody@example.test"}' \
  "$BASE/identity/accounts/prelogin"
```

The four GET requests must return `200`. The config response must advertise the
same origin in its `vault`, `api`, `identity`, and `notifications` URLs. The
synthetic prelogin request may be denied by account policy, but it must return a
structured HonoWarden response rather than DNS, TLS, HTML, or transport errors.

## Cloudflare Routing Contract

The API Worker is the origin, so each environment uses a Cloudflare Workers
Custom Domain. The contract is declarative in `wrangler.jsonc`:

```json
{
  "pattern": "vault.honowarden.com",
  "custom_domain": true
}
```

The staging declaration uses `vault-staging.honowarden.com`. Cloudflare owns the
generated proxied DNS record and edge certificate. Never add either hostname to
the website Worker's `honowarden.com/*` or `www.honowarden.com/*` routes.

After a route change, check all of the following before client use:

1. Cloudflare's Workers Custom Domains readback maps the hostname to the
   expected Worker service.
2. Public DNS resolves the hostname and TLS verification succeeds.
3. `/api/config` advertises only the requested stable origin.
4. `https://honowarden.com/` and its `/health` endpoint remain on the website
   Worker.

## Failure Diagnosis

- Website HTML or `404` from `/api/config`: the website apex was entered; use
  the environment-specific vault hostname.
- `Failed to fetch` with no Worker request: check DNS and TLS before inspecting
  credentials. A newly attached Custom Domain can resolve through public DNS
  before a local negative DNS cache expires. Wait for the system resolver to
  return the hostname and restart the isolated client before retrying.
- Structured `prelogin_not_allowed` or `invalid_grant`: routing is working;
  continue with account-policy or credential diagnosis.
- `server_misconfigured`: stop. Verify the target environment's Worker secrets
  and do not fall back to another environment.

Do not capture passwords, tokens, encrypted key material, or real vault data in
screenshots, traces, issue comments, or committed evidence.

## Rollback

For a planned rollback, remove only the affected environment's `routes` entry
from `wrangler.jsonc`, run the full repository gates, and deploy that environment
again. Read back Workers Custom Domains and DNS to confirm the hostname is no
longer attached. Do not re-enable `workers_dev` or preview URLs as a shortcut.

For an incident where deploy is unavailable, detach only the exact Workers
Custom Domain through the Cloudflare dashboard or Workers Domains API, using
the domain ID captured immediately before the change. Do not delete or retarget
the website apex routes. Reattach the same hostname to the same Worker service
to recover.
