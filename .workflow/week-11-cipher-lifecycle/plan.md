# Week 11 Cipher Lifecycle

## Goal

Implement authenticated cipher update, trash, restore, and permanent delete.

## Success Criteria

- Cipher update writes opaque encrypted JSON only for active ciphers owned by the authenticated user.
- Optional folder references are owner-checked.
- Trash, restore, and permanent delete are owner-scoped.
- Full sync continues to exclude deleted ciphers.
- Full local checks and CI pass.

## Current Context

- Week 10 added login cipher create and sync inclusion.
- D1 `ciphers` already has `deleted_at`, `revision_date`, and encrypted JSON columns.
- Cipher lifecycle is the next roadmap increment before multi-item reliability work.

## Constraints

- Do not decrypt, inspect, normalize, or log encrypted cipher fields.
- Do not implement attachments, collections, sends, or organizations.
- Keep upstream-provider brand strings out of tracked files.
- Do not set real secrets or deploy.

## Risks

- Update could mutate another user's cipher if owner scoping is incomplete.
- Restore could resurrect a row into a folder the user no longer owns if folder ownership is not checked on update.
- Permanent delete is destructive; keep it scoped and tested.

## Approval Required

No extra approval for local implementation and tests. Ask before real secrets, deploys, or remote resources.

## Work Packets

- `01-cipher-repository-lifecycle`: repository update/trash/restore/permanent delete.
- `02-cipher-route-lifecycle`: HTTP routes and response DTOs.
- `03-docs-fixtures`: docs/spec/current-state and compatibility notes.
- `04-verification`: full checks, smoke, workflow report, push, CI.

## Integration Policy

Any owner-scope failure blocks push. Any route that accepts missing/invalid tokens blocks push. Permanent delete must be physically destructive only after user ownership is checked in SQL.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verification

## Reusable Artifacts

- `.workflow/week-11-cipher-lifecycle/`
