# Packet 02: Staging Migrations

Objective: Apply migrations to remote staging D1 and verify schema state.

Do:

- Run migrations with `--remote`.
- Query `schema_migrations`.
- Query table names for required alpha tables.

Do not:

- Treat a local-only migration run as release evidence.
- Apply production migrations in this slice.

Verification:

- Remote staging reports versions `0001`, `0002`, and `0003`.
