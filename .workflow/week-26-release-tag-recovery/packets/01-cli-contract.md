Packet ID: 01-cli-contract
Objective: Lock the read-only release tag recovery packet contract in tests.
Files / sources: test/ops/release-tag-recovery-packet.test.ts, package.json
Ownership: tests

Do:

- Cover ready recovery output.
- Cover blocking when a GitHub release already exists.
- Cover strict failure without main CI evidence.
- Assert generated approval text and lease-guarded push command.

Do not:

- Create, move, delete, or push any real tag.
- Create, update, publish, or delete any GitHub release.

Expected output:

- Focused tests that fake git and gh reads.

Verification:

- pnpm exec vitest run test/ops/release-tag-recovery-packet.test.ts
