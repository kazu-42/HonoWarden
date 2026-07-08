Packet ID: 01-script

Objective: Implement a local-only mutation packet CLI for ready apply-plan JSON.

Ownership: `scripts/honowarden-linear-mutation-packet.mjs`

Do:

- Require `--apply-plan <path>`.
- Accept standalone `--`.
- Support `--strict`.
- Emit JSON only on stdout.
- Fail closed unless the input is a ready schema v1 apply plan.
- Split operations into mutation candidates, existing confirmations, and manual
  confirmations.
- Preserve operation payload fields.
- Do not read credentials or call network APIs.

Do not:

- Do not mutate Linear.
- Do not read `.env.local` or process credentials.
- Do not touch docs or workflow files.

Expected output: A script ready for tests and package wiring.
