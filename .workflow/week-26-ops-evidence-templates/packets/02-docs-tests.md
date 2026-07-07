Packet ID: 02-docs-tests

Objective: Link evidence placeholders and lock conservative behavior in tests.

Files:

- `docs/release/index.md`
- `docs/operations/website-email.md`
- `docs/current-state.md`
- `test/ops/ops-readiness-packet.test.ts`
- `test/release-docs.test.ts`

Do:

- Link the evidence files.
- Document that placeholders remain `not_performed`.
- Add tests that fail if the placeholders are accidentally marked passed.

Do not:

- Promote ops readiness to ready.
