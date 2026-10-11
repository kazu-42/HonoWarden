# Native Desktop API origins

Native Desktop renderers can use an opaque `null` origin for a bundled file,
or the explicit `bw-desktop-file://bundle` scheme. Neither is a user identity:
ordinary sandboxed browser documents can also have an opaque origin.

`HONOWARDEN_DESKTOP_CLIENTS_ENABLED=true` permits those two exact origin values
on `/api/`, `/identity/` and `/notifications/` routes. It remains false in all
tracked environments. Enabling it is part of the reviewed runtime configuration,
not a claim that native client acceptance has passed. Other origins, the admin
UI, public health endpoints and root protocol aliases do not gain opaque-origin
access from this option.

The client makes credentialed cross-origin requests, so successful responses
and preflights echo the exact admitted origin, allow credentials and vary on
Origin. A wildcard is not used. All existing method/header restrictions remain.
Vault authentication reads the Authorization bearer header; an origin or cookie
does not supply authentication. Session validity, current-family MFA, organization
authorization and writer feature gates remain independent requirements. A future
cookie-authentication feature must revisit this boundary before it is enabled.

The current Desktop API service requires HTTPS. A renderer `no-cors` fetch is not
a substitute for its actual API request: normal resource-policy restrictions can
block that probe even if the TCP connection is working. Native acceptance still
needs the signed client on each requested OS, the owned good-TLS/bad-TLS controls,
actual login/MFA, personal/shared decryption, permissions and cleanup.

Relevant pinned source in the official clients repository, commit
`8246ae9c9a484a0a69f8b27203034555fb872523`:

- `apps/desktop/src/main/window.main.ts`: Desktop window scheme.
- `libs/common/src/services/api.service.ts`: HTTPS and credential policy.
