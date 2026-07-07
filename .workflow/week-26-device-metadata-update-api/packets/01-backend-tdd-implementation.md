# Packet 01: Backend TDD Implementation

Objective: implement authenticated device metadata update behavior.

Files:

- `src/repositories/auth-repository.ts`
- `src/app.ts`
- `test/repositories/auth-repository.test.ts`
- `test/app.test.ts`
- `test/support/fake-d1.ts`

Do:

- Add failing repository and HTTP tests first.
- Implement owner-scoped active-device lookup and update.
- Accept `name`/`Name` and `type`/`Type`.
- Return the standard device response after update.
- Preserve stable JSON errors.

Do not:

- Change device identifiers.
- Implement trust or key update routes.
- Mutate external systems.
