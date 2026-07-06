# Week 12 Multi Item Round Trip

## Goal

Harden cipher round-trip behavior for 10 to 50 personal vault items.

## Success Criteria

- Login and secure-note ciphers can be created.
- Unknown encrypted fields round-trip through create, update, and sync.
- Favorite flags round-trip.
- Sync returns 50 active ciphers without dropping or reinterpreting encrypted payloads.
- Full local checks and CI pass.

## Current Context

- Week 11 added cipher update, trash, restore, and permanent delete.
- Cipher payloads are stored in `ciphers.encrypted_json`.
- Current request validation only accepts login cipher type.

## Constraints

- Do not decrypt, inspect, normalize, or log encrypted cipher fields.
- Do not add pagination, attachments, collections, sends, or organizations in this slice.
- Keep upstream-provider brand strings out of tracked files.
- Do not set real secrets or deploy.

## Risks

- Server metadata could be overridden by client payload fields.
- JSON round-trip could accidentally drop unknown encrypted fields.
- Supporting more cipher types could accidentally accept unsupported structures.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resources.

## Work Packets

- `01-cipher-validation`: allow secure-note cipher type while keeping malformed/unsupported requests rejected.
- `02-round-trip-tests`: add create/update/sync tests for unknown encrypted fields, favorites, and 50 ciphers.
- `03-docs-fixtures`: update spec/current-state and workflow reports.
- `04-verification`: full checks, smoke, brand scan, push, CI.

## Integration Policy

Any response path that lets request metadata override stored metadata blocks push. Any direct plaintext vault storage blocks push.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification

## Reusable Artifacts

- `.workflow/week-12-multi-item-round-trip/`
