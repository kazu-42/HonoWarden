# Compatibility Plan

HonoWarden aims for the smallest useful upstream-compatible API surface for personal and small-team vault sync.

## Initial Scope

- API-only server for official upstream clients
- self-hosted endpoint configuration
- account login and token refresh flows required by official clients
- personal vault sync for encrypted ciphers, folders, collections needed by small-team use, and attachments where required
- D1-backed metadata and encrypted vault records
- R2-backed larger encrypted objects

## Explicitly Out of Scope Initially

- Web Vault
- public registration
- Organizations administration
- Send
- SSO
- multi-tenant hosted operation
- enterprise policy management

## Compatibility Rules

- Prefer behavior observed from official clients over broad feature parity.
- Preserve end-to-end encryption boundaries; the server must not need plaintext vault secrets.
- Keep unsupported surfaces explicit with typed errors instead of silent partial behavior.
- Add compatibility tests before implementing each API surface.
- Keep executable JSON fixtures for client-facing response shapes under `compat/fixtures`.
- Treat fixture regressions as compatibility regressions once a route has been implemented.

This project is independent and not affiliated with, sponsored by, or endorsed by any upstream client or hosted-vault provider.
