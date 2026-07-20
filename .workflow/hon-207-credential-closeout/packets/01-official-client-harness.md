# CLIENT-1: Pinned Official-Client Harness

## Deliverables

- Exact server, Web, browser-extension, and CLI source pins.
- Exact CLI/browser release asset IDs, sizes, versions, and SHA-256 values.
- Ignored mode-0700 asset/profile/output directories.
- Official CLI command runner and deterministic official-crypto bridge.
- Secret-redaction, process-group cleanup, and provenance tests.

## Exit Gate

The harness creates client-compatible synthetic key material, round-trips it
through the pinned official implementation, and emits only redacted metadata.
No HonoWarden route, runtime flag, or compatibility row changes.
