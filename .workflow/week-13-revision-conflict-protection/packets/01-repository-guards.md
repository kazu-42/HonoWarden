Packet ID: 01-repository-guards
Objective: Add expected-revision update guards for folders and ciphers.
Context: Existing update repository operations only checked owner scope and active rows.
Files / sources: `src/repositories/folder-repository.ts`, `src/repositories/cipher-repository.ts`, repository tests.
Ownership: Repository update contracts and SQL predicates.
Do: Return `updated`, `not_found`, or `conflict`; guard writes with `revision_date = ?`; query current active revision only after a failed guarded update.
Do not: Change create, delete, restore, permanent delete, list, or schema behavior.
Expected output: Repository tests distinguish matching, missing, and stale updates.
Verification: `pnpm test -- test/repositories/folder-repository.test.ts test/repositories/cipher-repository.test.ts --run`.
