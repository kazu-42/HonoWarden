Result: 02-tests

- Added `test/ops/ops-readiness-packet.test.ts`.
- The focused tests cover draft-ready release state, email local input readiness
  without secret leakage, and strict readiness only after release, email input,
  and live evidence requirements all pass.
- Updated release docs tests to keep `pnpm ops:readiness:packet` referenced in
  the publication gate.
- Focused tests passed.
