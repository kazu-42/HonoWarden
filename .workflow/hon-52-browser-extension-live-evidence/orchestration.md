# Orchestration: HON-52 browser extension live evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# HON-52 Orchestration

## Decision Log

- Use the official upstream browser extension asset as downloaded, not a
  locally patched build.
- Keep all generated account secrets and raw traffic in ignored `test/.tmp/`.
- Prefer direct Chrome DevTools Protocol automation with a clean profile because
  the repository does not include Playwright/Puppeteer dependencies.
- If the extension cannot complete login because the server is missing a
  required protocol route, record the exact failing route and leave the matrix at
  `fixture_only` instead of promoting unsupported compatibility.

## Completed Packets

- `asset-provenance`: official browser and CLI assets were downloaded under
  ignored `test/.tmp/` paths and SHA-256 checked.
- `synthetic-account-crypto`: official CLI wasm crypto generated a synthetic
  account tuple that round-tripped through upstream decrypt paths.
- `local-worker`: local D1 was reset, migrated, bootstrapped, and verified with
  direct token exchange plus official CLI binary login.
- `browser-automation`: official browser extension completed self-hosted
  environment selection, password login, profile reads, sync route observation,
  and empty-vault render.
- `docs-tests-pr-linear`: matrix, release evidence, compatibility docs, and
  matrix tests were updated for a narrow `live_smoke` claim.

## Completion Notes

- The installed branded Chrome build did not expose the unpacked official
  extension under the local evidence flags. Brave's Chromium extension host was
  used with the same official browser artifact.
- The browser page CDP target captured foreground fetches. The extension sync
  fetch was recorded from wrangler dev route logging.
- `/notifications/hub` returned `404`; this remained non-blocking and outside
  the personal-vault smoke claim.
