# Final Report: HON-30 attachment storage

## Outcome

HON-30 local implementation is complete and ready for PR.

## Accepted Results

- D1 `cipher_attachments` metadata with owner and cipher scope.
- R2-backed cipher-scoped attachment upload, download, and delete routes.
- Sync/list/read response metadata injection without exposing internal object
  keys.
- Compatibility fixture coverage for attachment sync metadata.
- Backup/restore and security documentation updates for `attachments/` R2
  objects.

## Rejected Results

- Top-level `/api/attachments` collection APIs remain unsupported.
- Live official-client attachment upload/download/delete evidence was not run in
  this local implementation workflow.

## Conflicts Resolved

- R2 and D1 are not transactional together. Upload writes R2 first and cleans up
  the just-written object if metadata persistence fails. Delete removes R2
  before metadata so an R2 failure leaves metadata available for retry.

## Verification Evidence

- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts`
- `pnpm exec vitest run test/migrations.test.ts test/repositories/attachment-repository.test.ts test/app.test.ts test/compat test/release-docs.test.ts test/security-docs.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm format`
- `pnpm test`
- `git diff --check`

## Remaining Risks

- No production/staging migration or deploy was performed.
- No official client binary attachment run was captured; metadata shape is
  fixture-covered only.
- Large attachments are parsed through Worker `formData()` in this alpha
  implementation; live client and platform-size behavior need follow-up before
  real usage.

## Reusable Follow-up

- Use `--r2-prefix attachments/` for attachment-aware backup drills.
- Add live client attachment upload/download/delete evidence before promoting
  compatibility rows beyond fixture coverage.
