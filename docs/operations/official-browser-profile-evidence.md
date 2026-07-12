# Official Browser Profile Evidence

This runbook creates a disposable official browser-extension profile for the
HON-94 and HON-95 staging evidence lanes. It never uses a normal browser profile
and must never enter real vault credentials.

Status: passed for HON-94 on 2026-07-11.

## Pinned Source

- Official upstream clients repository ID: `53538899`
- Release: `browser-v2026.6.1`
- Published: `2026-06-30T17:07:46Z`
- Asset: `dist-chrome-2026.6.1.zip`
- GitHub release asset ID: `462351736`
- Size: `21593500` bytes
- SHA-256:
  `fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e`
- Machine-readable source:
  `https://api.github.com/repositories/53538899/releases/assets/462351736`

The asset URL, digest, size, Manifest V3 version, and background service worker
are pinned in the CLI. A mismatch removes the partial profile and fails loudly.

## Plan And Prepare

Review the non-mutating packet:

```sh
pnpm client:browser-profile -- prepare
```

Prepare the default ignored root:

```sh
pnpm client:browser-profile -- prepare \
  --execute --confirm clean-browser-profile
```

The prepared root is `test/.tmp/hon-94-browser-profile/` and contains:

- the mode-`0600` pinned release asset;
- the unpacked official extension;
- an initially empty, dedicated Brave profile;
- a mode-`0600` non-secret state packet with release, manifest, browser host,
  and staging endpoint metadata.

The CLI refuses paths outside ignored `test/.tmp/`, symlinks, existing roots,
digest/size/manifest mismatches, and missing Brave version readback.

## Launch

Launch only the prepared profile. Keep the process in a dedicated terminal so
it can be closed before cleanup:

```sh
ROOT="$PWD/test/.tmp/hon-94-browser-profile"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

"$BRAVE" \
  --user-data-dir="$ROOT/profile" \
  --disable-extensions-except="$ROOT/extension" \
  --load-extension="$ROOT/extension" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9224 \
  --no-first-run \
  --no-default-browser-check
```

Secret-safe startup readback:

```sh
curl -fsS http://127.0.0.1:9224/json/list | jq \
  '[.[] | select(.url | startswith("chrome-extension://")) | {type, url}]'
```

Record the Brave version, extension release/digest, extension target type, and
manifest version. Do not record account identifiers, tokens, profile LevelDB,
extension storage, encrypted keys, or request payloads.

### HON-95 Chromium Host Note

The HON-95 login-with-device run kept the same pinned official extension but
used isolated Chrome for Testing `149.0.7827.55`. The installed Brave host had
unstable duplicate-app behavior during repeated extension popup launches, and
current Chromium disabled the unpacked extension after popup close unless the
explicit test-only flag was present.

```sh
"/path/to/Google Chrome for Testing" \
  --user-data-dir="$ROOT/profile" \
  --disable-extensions-except="$ROOT/extension" \
  --load-extension="$ROOT/extension" \
  --enable-unsafe-extension-debugging \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9224 \
  --no-first-run \
  --no-default-browser-check
```

This is an evidence-host override, not a compatibility pin or a recommended
daily-browser setting. The extension asset, digest, ignored profile boundary,
and cleanup requirements remain unchanged.

## Staging Boundary

HON-94 proves that the pinned extension starts in an isolated empty profile.
HON-95 owns human entry of the synthetic fixture and the UI flow. In HON-95,
select the self-hosted environment and use only:

```text
https://honowarden-staging.ghive42.workers.dev
```

Retrieve synthetic email/password one field at a time with
`pnpm client:auth-fixture -- clipboard`; never type, paste, or synchronize real
vault credentials in this profile.

## Status And Cleanup

Inspect structural state without reading extension storage:

```sh
pnpm client:browser-profile -- status \
  --execute --confirm clean-browser-profile
```

An untouched prepared profile reports zero profile entries. A launched profile
reports `used`; this is expected and does not claim whether credential storage
exists. Close Brave before cleanup.

```sh
pnpm client:browser-profile -- cleanup \
  --execute --confirm clean-browser-profile
```

Cleanup refuses an in-use profile, removes only the confirmed ignored root,
clears the clipboard, and must report `rootExists: false`. If cleanup fails,
leave HON-94/HON-95 open and inspect the process/root boundary without broadening
the deletion path.

## HON-94 Live Readback

The pinned prepare/launch/status/cleanup sequence completed on 2026-07-11:

- asset SHA-256 and size matched the official GitHub release;
- manifest version was `2026.6.1`, format was Manifest V3, and the background
  service worker was `background.js`;
- host version was `Brave Browser 150.1.92.134` with Chromium
  `Chrome/150.0.7871.63` and CDP protocol `1.3`;
- CDP reported one official extension `service_worker` target at
  `/background.js`;
- a disposable popup target rendered route `#/intro-carousel` with 173 DOM
  elements, non-empty body text, and zero runtime exceptions;
- post-launch status reported 39 profile entries and
  `containsCredentials: null`, intentionally making no storage claim;
- the dedicated Brave process exited before cleanup;
- cleanup reported `rootExists: false` and `clipboardCleared: true`;
- independent readback found the root absent, clipboard size `0`, and CDP port
  `9224` closed.

After switching download to the numeric GitHub asset API, a second
prepare/hash/manifest/cleanup pass returned the same pinned extension and found
the auto-updated host version `Brave Browser 150.1.92.139`. That second pass did
not repeat the UI flow. The extension release/digest is the compatibility pin;
host versions `.134` and `.139` are recorded separately rather than treated as
the same launch evidence.

The screenshot and browser profile remained under ignored storage and were
deleted by cleanup. No account identifier, credential, token, extension
storage, encrypted key, or request payload was retained.
