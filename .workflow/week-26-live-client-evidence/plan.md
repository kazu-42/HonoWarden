# Week 26 Live Client Evidence Plan

## Goal

Capture a redacted synthetic live smoke for the tracked CLI client against the
HonoWarden Worker before alpha tagging.

## Scope

- Run the real CLI version listed in `compat/client-matrix.json`.
- Use local wrangler dev and local D1 only.
- Use only synthetic account data and an empty vault.
- Prove config, prelogin, password grant, sync, and account revision lookup.
- Record evidence without passwords, hashes, session keys, access tokens,
  refresh tokens, generated key material, or real vault data.

## Non-Goals

- Browser, desktop, Android, or iOS live evidence.
- Full item mutation through a real client.
- TOTP live login through a real client.
- Staging or production deploy evidence.
