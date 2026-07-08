Packet ID: 02-tests

Objective: Cover the mutation packet CLI behavior with child-process tests.

Ownership: `test/ops/linear-mutation-packet.test.ts`

Do:

- Test missing `--apply-plan` failure.
- Test blocked apply-plan input.
- Test ready apply-plan classification.
- Test strict mode exits non-zero when blocked.
- Test no-network and no credential leak behavior.
- Use temporary JSON fixtures.

Do not:

- Do not perform live network calls.
- Do not rely on local credentials.

Expected output: Deterministic tests matching existing ops test style.
