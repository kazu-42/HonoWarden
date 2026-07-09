# Final Report: HON-52 browser extension live evidence

Status: passed

Completed at: `2026-07-09T23:28:40Z`

## Outcome

The official `browser-v2026.6.1` browser-extension artifact completed a local
synthetic password-login smoke against the HonoWarden Worker. The extension
saved the self-hosted host `127.0.0.1:8790`, reached the vault route, rendered
the empty-vault loaded state, and did not emit console errors or runtime
exceptions during the captured run.

## Accepted Results

- Official browser asset SHA-256:
  `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e`
- Official CLI wasm crypto generated the synthetic account bootstrap material.
- Synthetic-account crypto round trips passed for wrapped user key and wrapped
  private key.
- Local Worker bootstrap returned `POST /api/accounts/bootstrap 201`.
- Browser extension CDP captured:
  - `GET /api/config 200`
  - `POST /identity/accounts/prelogin/password 200`
  - `POST /identity/connect/token 200`
  - `GET /api/accounts/profile 200`
- wrangler dev logged `GET /api/sync 200` during the browser-extension login
  run.
- Popup final route:
  `chrome-extension://[extension-id]/popup/index.html#/tabs/vault`
- Popup final state contained the empty-vault loaded message.

## Rejected Results

The installed branded Chrome build was not accepted as the evidence host
because it did not expose the unpacked official extension under the local
extension-loading flags. The same official extension artifact was loaded in
Brave's Chromium extension host instead.

## Conflicts Resolved

The foreground popup CDP target did not attribute the background sync fetch.
The run therefore records foreground fetches from CDP and the sync fetch from
wrangler dev route logging. This is sufficient for a narrow `live_smoke`
promotion, but it is not enough for `live_regression`.

## Verification Evidence

- `docs/release/browser-extension-live-client-evidence.md`
- `compat/client-matrix.json`
- `docs/compatibility-matrix.md`
- Ignored raw evidence:
  `test/.tmp/hon-52-browser-extension/evidence/browser-extension-cdp-run.json`
- Ignored raw evidence:
  `test/.tmp/hon-52-browser-extension/evidence/browser-extension-sync-reload.json`

## Remaining Risks

- Official branded Chrome host behavior is not proven by this run.
- Desktop, Android, iOS, TOTP, refresh rotation, device key update, bulk device
  trust, item lifecycle, attachments, Organizations, Send, Web Vault, and
  notification hub behavior remain outside this evidence.
- `/notifications/hub` returned `404`; it did not block vault load, but
  notification/socket compatibility is not claimed.

## Reusable Follow-up

For `live_regression`, attach CDP to both the popup page target and the
extension service worker before login, then drive item create/update/delete and
refresh/session lifecycle flows. Keep raw tokens and account material in
ignored `test/.tmp/` files only.
