Packet ID: 01-script
Objective: Implement a deterministic local-only Linear apply-plan command.
Ownership: `scripts/honowarden-linear-apply-plan.mjs`, `package.json`.
Do:

- Read the seed from `ops/linear/honowarden.seed.json` by default.
- Accept `--seed`, `--preflight-report`, `--strict`, and a standalone `--`.
- Emit JSON only; never call the network or read credentials.
- Classify operations based on a ready preflight report when supplied.
  Do not:
- Perform live Linear mutations.
- Print or inspect `LINEAR_API_KEY`.
  Expected output: script plus package command.
  Verification: targeted apply-plan tests.
