# Packet: Route Audit Coverage

## Objective

Add opt-in audit events for folder, cipher, and attachment mutation routes.

## Scope

- `src/domain/audit.ts`
- `src/app.ts`
- `test/app.test.ts`

## Verification

Route tests assert event names, safe result context, actor/target IDs, and the
absence of encrypted payloads, tokens, secrets, R2 object keys, attachment keys,
request bodies, and object bytes.
