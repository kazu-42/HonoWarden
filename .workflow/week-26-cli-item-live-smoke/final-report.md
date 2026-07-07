# Final Report: Week 26 CLI Item Live Smoke

## Outcome

In progress. The local synthetic CLI live smoke now passes login, initial sync,
item create, forced sync/readback, item update, soft delete/trash sync, and
permanent delete.

## Accepted Results

- `POST /api/ciphers` succeeds for one synthetic login item.
- Cipher responses normalize response-only shapes needed by the CLI SDK without
  mutating stored encrypted payloads.
- `PUT /api/ciphers/:id` accepts `lastKnownRevisionDate` for update
  concurrency and preserves original `creationDate`.
- `PUT /api/ciphers/:id/delete` performs soft delete for the CLI route.
- `DELETE /api/ciphers/:id` performs permanent delete for the CLI route.
- Sync includes user-owned trashed ciphers with `deletedDate`, so forced sync
  can rebuild the trash list.

## Rejected Results

- Treating the CLI attachment map as a stored model change was rejected. The
  fix is response normalization only.
- Keeping `DELETE /api/ciphers/:id` as soft delete was rejected after the CLI
  showed soft delete uses `PUT /api/ciphers/:id/delete`.
- Treating the empty trash list as a CLI list issue was rejected after direct
  sync inspection showed deleted ciphers must remain in the sync payload.

## Conflicts Resolved

- Update responses initially changed `creationDate` to the update timestamp.
  Repository update now uses the existing row creation timestamp while keeping
  revision-based optimistic concurrency.

## Verification Evidence

- `pnpm test test/app.test.ts test/repositories/cipher-repository.test.ts`
  passed: 2 files, 90 tests.
- `pnpm check` passed.
- Local CLI smoke passed with synthetic data:
  create, sync/readback, update, soft delete, forced trash sync/list,
  permanent delete, forced empty trash sync/list.

## Remaining Risks

- The CLI smoke uses a local HTTPS proxy to avoid a wrangler dev compression
  transport issue.
- Folder mutation, refresh rotation, TOTP login, and attachments are not yet
  covered by live CLI evidence.
- Browser, desktop, Android, and iOS remain fixture-only.

## Reusable Follow-up

- Convert the manual CLI item lifecycle smoke into a repeatable ignored script
  or CI-local smoke once the local HTTPS transport workaround is automated.
- Add live CLI folder mutation and refresh rotation slices next.
