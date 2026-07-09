# Security Review Index

Last reviewed: 2026-07-09.

Use these documents together when reviewing alpha readiness:

- [Threat Model](threat-model.md)
- [Data Flow](data-flow.md)
- [Authentication State Machine](auth-state-machine.md)
- [Secrets Inventory](secrets-inventory.md)
- [Incident Response Runbook](incident-response.md)
- [Formal Secret Rotation Drill](../operations/secret-rotation-drill.md)
- [Access Token Key Rotation Runbook](../operations/access-token-key-rotation.md)
- [Incident Response Exercise Evidence](incident-response-exercise.md)
- [Secret Rotation Drill Evidence](../release/secret-rotation-drill-evidence.md)
- [Known Limitations](known-limitations.md)
- [Dependency Audit Evidence](dependency-audit.md)

## Local Evidence

- `pnpm audit --audit-level low`: see
  [Dependency Audit Evidence](dependency-audit.md).
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan
- workflow verifier

## Review Rules

- Do not promote compatibility rows beyond `fixture_only` without linked live
  request and response evidence.
- Do not enable audit logs in production until log retention and access are
  explicitly approved.
- Do not use real secrets or real personal vault data during alpha dogfood.
- Do not treat encrypted payloads, backups, or platform logs as low sensitivity.
- Do not treat the incident response tabletop or formal secret rotation dry-run
  as a completed live secret rotation, Cloudflare account hardening, external
  audit, or production incident drill.
