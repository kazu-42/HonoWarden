# HON-48 vault audit coverage

## Goal

Add secret-safe audit coverage for high-value vault mutation routes and backup
operator commands.

## Success Criteria

- Folder create/update/delete and cipher create/update/delete/restore/permanent
  delete emit opt-in audit events without encrypted payload values.
- Attachment upload/delete emit opt-in audit events without file names,
  attachment keys, R2 object keys, or object bytes.
- Backup CLI export/restore stdout includes an audit packet with action,
  execution state, result status, and manifest id/path only.
- Existing audit persistence behavior remains opt-in and fail-loud when enabled.
- Tests prove no token, secret, request body, encrypted payload, or object key
  leaks into audit events or backup audit packets.

## Current Context

- HON-47 added D1 audit persistence behind `HONOWARDEN_AUDIT_LOGS=true`.
- Existing `backup.export` route audit covers user export success/failure.
- Vault mutation routes currently return successful responses without
  folder/cipher/attachment audit events.

## Constraints

- No production migration or deploy.
- Audit logging disabled must keep existing behavior and avoid extra D1 writes.
- Do not log encrypted folder names, encrypted cipher JSON, encrypted file names,
  attachment keys, request/response bodies, bearer tokens, or object keys.

## Risks

- Adding audit writes before mutations can record events for operations that did
  not commit.
- Adding encrypted request fields to context would weaken the audit boundary.
- Operator backup CLI output is local evidence, not persisted Worker audit.

## Approval Required

- Local implementation, tests, docs, PR are covered by the user's autonomy
  instruction.
- Production deploy or live backup execution is not in scope.

## Work Packets

- Route audit coverage: folder/cipher/attachment route tests and app changes.
- Backup audit packet: CLI tests and script output changes.
- Docs/workflow: update audit, backup, data-flow, current-state, release docs.
- Verification: focused tests, full tests, release gate, PR/main CI.

## Integration Policy

Only emit audit after a mutation outcome is known. For failure outcomes that are
safe and useful to incident review, record enum-like reasons only.

## Verification

- focused route audit tests
- backup CLI tests
- `pnpm format`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm release:gate -- --strict`
- workflow verifier
- `git diff --check`

## Reusable Artifacts

HON-48 builds on HON-47 and provides the baseline for future dashboard/log-sink
issues.
