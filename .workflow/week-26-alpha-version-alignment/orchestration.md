# Orchestration: Week 26 Alpha Version Alignment

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Do not tag, deploy, or publish in this slice.
- Keep safety/status warnings explicit while aligning version identifiers.

## Branching Rules

- If version metadata appears in multiple files, centralize runtime code and test
  package/runtime consistency.
- If release docs still say tag is not cut, keep that distinction.

## Packet Prompts

- Version source: add or use a central constant for `0.1.0-alpha`.
- Runtime metadata: root, health, and config should use that constant.
- Tests/docs: update app and release docs tests to prevent drift.

## Completion Audit

- `package.json` version is `0.1.0-alpha`.
- Root metadata includes `version: 0.1.0-alpha`.
- Health and config return `0.1.0-alpha`.
- Release gate remains ready.
