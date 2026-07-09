# Packet 01: Implementation

Objective:
Add reusable local synthetic evidence machinery for HON-61.

Files:

- `test/support/fake-d1.ts`
- `scripts/honowarden-dogfood-evidence-packet.mjs`
- `test/ops/dogfood-evidence-packet.test.ts`
- `test/ops/dogfood-synthetic-lifecycle.test.ts`
- `package.json`

Do:

- make bootstrap inserts visible to later fake auth lookups when tests provide a
  mutable `authUsers` array;
- keep explicit `userInsertChanges` override behavior intact;
- validate required dogfood flows in strict mode;
- keep secrets and real identifiers out of packet output.

Do not:

- mutate Cloudflare, D1, routing, or real accounts;
- weaken existing disabled-user auth guards.
