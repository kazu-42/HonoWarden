# Security Known Limitations

Last reviewed: 2026-07-06.

HonoWarden remains pre-alpha. These limitations are release and operations
inputs, not minor documentation notes.

## Release Blockers Before Real Secrets

- no independent security audit has been completed
- only a CLI live smoke has been captured; no full live client regression suite
  exists yet
- no production backup restore drill has been recorded
- no Cloudflare account access-control review is documented
- no incident response runbook exists
- no formal secret rotation drill has been run

## Current Product Gaps

- Web Vault is intentionally not implemented.
- Public registration is disabled.
- Organizations and shared vaults are not implemented.
- Send is not implemented.
- read-only device list endpoints (`GET /api/devices`, `GET /api/devices/identifier/:identifier`), anonymous preflight (`GET /api/devices/knowndevice`), device metadata mutation, and device encrypted-key update routes are implemented; bulk trusted-device approval and login-with-device workflows are not.
- account disable/enable operator CLI is dry-run-first, but no admin UI or live
  production lifecycle evidence is recorded yet.
- AI inquiry inbox architecture is documented, but the inbox Worker, mailbox
  UI, email body or attachment storage, AI triage, approved outbound replies,
  and Linear issue creation automation are not implemented yet.

## Security Control Gaps

- Audit events are platform log lines only; they are not persisted with retention
  controls in D1.
- Audit event coverage does not include every vault CRUD route.
- Backup/restore evidence is operator-runbook based; no scheduled job exists.
- R2 object backup can auto-list remote buckets, but there is no scheduled
  production backup job or remote production backup evidence yet.
- TOTP wrapping-secret rotation has no migration tool.
- Access tokens use a symmetric HMAC secret; there is no key id or staged key
  rotation support yet.
- Rate limiting focuses on password grant, not all authenticated routes.
- There is no global request quota or abuse monitoring dashboard.

## Testing Gaps

- Compatibility rows remain `fixture_only` unless linked live evidence exists.
- Test support models selected D1 query shapes, not full SQLite behavior.
- Security docs are CI-checked for presence and key content, but not formally
  reviewed by an external auditor.

## Operational Gaps

- Production deployment remains blocked by placeholder D1 IDs and staging-first
  evidence requirements.
- Cloudflare log retention and access rules must be decided before enabling
  audit logs in production.
- Backup directories and manifests need an operator-owned retention policy.
- Vulnerability disclosure depends on GitHub private vulnerability reporting or
  a temporary private channel.
- `security@honowarden.com` must not accept real vulnerability-report content
  until Email Routing, destination verification, inbound smoke evidence, and
  the inquiry inbox retention/redaction rules are implemented.
