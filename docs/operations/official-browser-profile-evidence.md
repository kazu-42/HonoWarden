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

Run exactly one host-specific prepare command from the Launch section below.
Do not prepare both hosts against the same root.

The prepared root is `test/.tmp/hon-94-browser-profile/` and contains:

- the mode-`0600` pinned release asset;
- the unpacked official extension;
- an initially empty, dedicated evidence-browser profile;
- a mode-`0600` non-secret state packet with release, manifest, browser host,
  and staging endpoint metadata.

The CLI refuses unsupported browser names, paths outside ignored `test/.tmp/`,
symlinked roots or executables, executables under normal browser profile
directories, existing roots, digest/size/manifest mismatches, and missing or
invalid selected-host version readback. Launch arguments come only from the
fixed per-host registry; operators cannot append arguments through this CLI.

## Launch

The CLI never starts a browser. Choose exactly one supported host while
preparing the profile, then copy only `launch.executable` and the ordered, fixed
`launch.args` from the emitted JSON packet into a dedicated terminal. This
CLI-emitted per-host launch contract is authoritative; do not append or replace
launch arguments. Both contracts keep CDP on `127.0.0.1` with
`--remote-debugging-port=0`. Chromium chooses an ephemeral port and writes the
owned browser path and port to the disposable profile's `DevToolsActivePort`
file. Readback must reject symlinks, non-private profiles, malformed values,
and a `/json/version` WebSocket URL that differs from that owned endpoint.

### Brave Browser (default)

```sh
pnpm client:browser-profile -- prepare \
  --browser brave \
  --execute --confirm clean-browser-profile
```

Brave Browser uses its registered default executable unless
`--browser-executable` or the backward-compatible
`HONOWARDEN_BRAVE_EXECUTABLE` override is supplied. Its emitted contract does
not include `--enable-unsafe-extension-debugging`.

### Chrome for Testing

Chrome for Testing has no default executable. Supply its executable explicitly:

```sh
pnpm client:browser-profile -- prepare \
  --browser chrome-for-testing \
  --browser-executable "/path/to/Google Chrome for Testing" \
  --execute --confirm clean-browser-profile
```

Its emitted fixed launch contract includes
`--enable-unsafe-extension-debugging`. This flag is evidence-only and must
never be used with a daily browser profile.

Secret-safe startup readback:

```sh
profile=test/.tmp/hon-94-browser-profile/profile
port="$(sed -n '1p' "$profile/DevToolsActivePort")"
curl -fsS "http://127.0.0.1:${port}/json/list" | jq \
  '[.[] | select(.url | startswith("chrome-extension://")) | {type, url}]'
```

The automated HON-220 readback additionally checks that `/json/version`
returns the exact `webSocketDebuggerUrl` recorded in `DevToolsActivePort`
before it calls any target or browser-close endpoint.

Record the selected host name and version, extension release/digest, extension
target type, and manifest version. Do not record account identifiers, tokens,
profile LevelDB, extension storage, encrypted keys, or request payloads.

### HON-95 Chromium Host Note

The HON-95 login-with-device run kept the same pinned official extension but
used isolated Chrome for Testing `149.0.7827.55`. The installed Brave host had
unstable duplicate-app behavior during repeated extension popup launches, and
current Chromium disabled the unpacked extension after popup close unless the
explicit test-only flag was present.

Launcher update on 2026-07-13: select `chrome-for-testing` with the per-host
command above. The CLI now emits the required test-only flag in its fixed launch
contract; do not add it manually.

This is an evidence-host override, not a compatibility pin or a recommended
daily-browser setting. The extension asset, digest, ignored profile boundary,
and cleanup requirements remain unchanged.

`--enable-unsafe-extension-debugging` is evidence-only and must never be used
with a daily browser profile.

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
exists. Close the selected evidence-browser host before cleanup.

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
- independent readback found the root absent, clipboard size `0`, and the
  run-owned ephemeral CDP endpoint closed.

After switching download to the numeric GitHub asset API, a second
prepare/hash/manifest/cleanup pass returned the same pinned extension and found
the auto-updated host version `Brave Browser 150.1.92.139`. That second pass did
not repeat the UI flow. The extension release/digest is the compatibility pin;
host versions `.134` and `.139` are recorded separately rather than treated as
the same launch evidence.

The screenshot and browser profile remained under ignored storage and were
deleted by cleanup. No account identifier, credential, token, extension
storage, encrypted key, or request payload was retained.
