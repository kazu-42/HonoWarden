# Packet: TDD Implementation

Objective: add the HON-41 user backup export API without widening the public
backup or operator recovery surface.

Files:

- `src/app.ts`
- `src/domain/audit.ts`
- `test/app.test.ts`

Do:

- require recent password authentication
- read only authenticated user rows through existing repository helpers
- omit password hashes, token material, raw R2 bodies, internal R2 keys, and
  cross-user rows
- emit `backup.export` audit events with count-only context

Do not:

- add Cloudflare deploys, migrations, production backups, or live smoke
- add unreliable in-memory Worker rate limits

Verification:

- RED test failed with 404 before route implementation
- GREEN focused app tests passed after implementation
