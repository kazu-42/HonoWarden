# Result 01: Audit Domain

Accepted:

- Added `src/domain/audit.ts`.
- Added event schema version `1`.
- Added serializer and opt-in parser.
- Added sensitive context key filtering.
- Added tests proving passwords, tokens, and encrypted payload values are omitted when their keys are secret-like.

Rejected:

- Arbitrary raw payload logging.

Verification:

- `pnpm test -- test/domain/audit.test.ts`
