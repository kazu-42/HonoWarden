# Orchestration: HON-30 attachment storage

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If route compatibility is ambiguous, implement a minimal documented route set
  and capture the ambiguity in live-client evidence follow-up instead of guessing
  more endpoints.
- If R2 or D1 local emulation makes a test brittle, isolate the behavior behind
  in-memory fake implementations and keep repository tests SQL-focused.
- If a production/staging check is needed, stop before mutating and ask for a
  separate approval gate.

## Packet Prompts

- Schema/repository: add `cipher_attachments` metadata and owner-scoped
  repository methods; verify generated SQL has user/cipher predicates.
- API routes: replace attachment placeholder routes with authenticated upload,
  download, and delete; inject attachment metadata into cipher responses.
- Fixtures/docs: update compat flow, current state, live evidence, and
  backup/restore references for `attachments/` R2 prefix.
- Verification: run targeted and broad checks, update final report with exact
  command evidence.

## Completion Audit

- Linear HON-30 is In Progress before implementation and Done only after merge
  and CI readback.
- No secret values or real vault data appear in code, docs, comments, PR, or
  Linear.
- Remote migrations/deploys are not performed in this workflow.
