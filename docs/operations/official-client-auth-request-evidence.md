# Official Client Auth-Request Evidence

This runbook prepares and removes the synthetic staging account used to verify
login-with-device in the official Desktop application and official browser
extension. The CLI is dry-run by default and refuses production.

It does not automate the clients' protected credential stores. A human enters
the synthetic credentials into the clean client profiles. D1 polling remains
authoritative; WebSocket notifications are delivery hints.

## Fixture Source

Use synthetic account material generated and round-trip verified by an official
CLI crypto implementation. Keep the JSON under ignored `test/.tmp/`. It must:

- use an `example.test` email;
- include a synthetic password and wrapped account keys;
- record successful wrapped-user-key and wrapped-private-key verification;
- contain no real account, personal data, or real vault material.

The fixture CLI validates the official CLI release/hash metadata and the
positive round-trip assertions recorded by the fixture generator; it does not
claim to recompute the client cryptography. The fixture file must resolve under
ignored `test/.tmp/` and have mode `0600` or stricter. The CLI never prints the
email or password, master-password hash, wrapped user key, or private key.

## Plan And Seed

Review a non-mutating plan:

```sh
pnpm client:auth-fixture -- seed \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json
```

Seed only the staging database after confirming the exact fixture operation:

```sh
pnpm client:auth-fixture -- seed \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json \
  --execute --confirm staging-fixture
```

The mutation replaces only the fixture's exact normalized identity. SQL carrying
synthetic key material is passed to Wrangler through a mode `0600` temporary
file and removed after execution. The CLI does not support a production target.
Status readback uses the scoped `CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN` and sends
the normalized synthetic email as a parameterized Cloudflare API request body,
not a process argument. It never falls back to the global API key.

## Protected Clipboard

Select one field at a time without emitting it to terminal output:

```sh
pnpm client:auth-fixture -- clipboard --field email \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json \
  --execute --confirm staging-fixture

pnpm client:auth-fixture -- clipboard --field password \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json \
  --execute --confirm staging-fixture
```

Paste into the isolated official Desktop or official browser extension profile.
Do not use a normal profile containing real vault data.

## Isolated Client Launch

Keep the real macOS `HOME` for the official Desktop process. A synthetic `HOME`
changes the native credential-store boundary and can leave the client waiting
after otherwise successful token and sync responses. Isolate only Electron's
profile and force the official disk-backed token mode for this synthetic run:

```sh
launchctl setenv ACCESS_TOKEN_LOCATION DISK
open -na /path/to/OfficialDesktopClient.app --args \
  --user-data-dir=/absolute/path/under/test/.tmp/desktop-profile \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9225
launchctl unsetenv ACCESS_TOKEN_LOCATION
```

Run the launch and `unsetenv` back-to-back so unrelated GUI processes do not
inherit the temporary setting. `ACCESS_TOKEN_LOCATION=DISK` is an official
client switch; it avoids creating or deleting normal official-client Keychain
items.
Never reuse the isolated profile with a real account.

Current Chromium hardening can disable unpacked extensions after the popup
closes. For the isolated evidence browser only, launch with
`--enable-unsafe-extension-debugging` in addition to the arguments printed by
`client:browser-profile`. Do not add that flag to a daily browser profile.

The official login-with-device command appears only after
`GET /api/devices/knowndevice` returns `true`. Bootstrap the same synthetic
browser profile once with its synthetic password, log out, and then start the
login-with-device evidence flow. This creates no real vault data.

## Evidence Flow

1. Seed staging and capture only the secret-safe status packet.
2. Log the approving official Desktop client in with the password grant.
3. Start login-with-device from the clean official browser extension.
4. Confirm `POST /api/auth-requests/` succeeds, the request appears through
   owner notification type `15`, and the pending request API returns it.
5. Approve in Desktop and complete token consumption in the browser extension.
6. Confirm the requester opened
   `/notifications/anonymous-hub?Token=<request-id>`, received response type
   `16` through the official `AuthRequestResponseRecieved` target, and then
   read the authoritative response endpoint.
7. Verify the response endpoint, one-time consumption, refresh behavior, and
   replay rejection. The current official extension uses the anonymous
   notification to trigger its response read; do not claim automatic timed
   polling when notification delivery is unavailable.
8. Record client versions, HTTP status classes, notification type, Worker
   version, and redacted counts. Never record credentials or encrypted keys.
9. Run cleanup and require a `clean` packet before closing the issue.

Read status at any point:

```sh
pnpm client:auth-fixture -- status \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json \
  --execute --confirm staging-fixture
```

## Cleanup

Cleanup deletes only the exact fixture identity, clears the clipboard, and
checks user, device, refresh-token, auth-request, orphan-device, and foreign-key
counts:

```sh
pnpm client:auth-fixture -- cleanup \
  --fixture test/.tmp/hon-52-browser-extension/synthetic-account.json \
  --execute --confirm staging-fixture
```

If status is not `clean`, keep the parent Linear issue open and inspect the
secret-safe counts. Do not broaden deletion predicates or manually remove
unrelated staging rows.

## Failure And Recovery

- A missing/invalid fixture fails before D1 access.
- Missing exact confirmation fails before clipboard or D1 mutation.
- Any production environment or non-staging database is rejected.
- D1 failure is reported without replaying Wrangler stderr, which may contain
  synthetic SQL.
- Cleanup clears the clipboard even when D1 deletion fails.
- Notification failure does not invalidate a successful approval. Verify the
  same state through the response endpoint, then reconnect or create a fresh
  request instead of assuming the official UI is performing timed polling.
