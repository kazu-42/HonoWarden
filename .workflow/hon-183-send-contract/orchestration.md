# Orchestration: HON-183 Send Slice S1 Contract

## Execution Rules

- Keep the existing Send and `send_access` runtime guards unchanged.
- Treat source pins as compatibility evidence, not as permission to copy
  implementation details or provider-specific product expression.
- Add tests before contract documents and capture the expected RED failure.
- Design for Worker/D1/R2 failure and concurrency semantics, not only happy-path
  HTTP shapes.
- Keep source capability, runtime activation, live verification, and production
  readiness as separate claims.
- Require exact marker, byte count, and SHA-256 readback for managed Linear
  checkpoint comments.

## Branching Rules

- If official-client and official-server shapes disagree, preserve the client
  wire shape and document a compatibility translation instead of guessing.
- If a future route would expose a Send before file validation or object
  activation, keep it guarded and revise the lifecycle contract.
- If access-count enforcement cannot be expressed as one conditional D1 write,
  the public endpoint is not eligible for activation.
- If a required migration, binding, secret, cleanup schedule, rate-limit store,
  or audit sink is absent, feature activation must fail closed with `503` and
  config must continue to advertise disabled.
- If verification discovers a current guard regression, fix the regression in
  this slice; do not continue into stateful Send behavior.

## Packet Prompts

### 01-contract-research

Audit the pinned official client/server owner routes, public access-token flow,
password KDF inputs, encrypted payload boundary, access-count semantics, file
upload/download flow, and error behavior. Map them against ADR 0003, ADR 0009,
`src/app.ts`, config, and current regression tests.

### 02-design-docs-tests

Write a regression test that specifies the required replacement ADR, dedicated
threat model, protocol wire contract, state machine, activation gate, rollback,
and source pins. Confirm RED, then write the smallest complete documentation set
that passes without changing runtime behavior.

### 03-verification-linear

Run focused tests, full repository gates, workflow verification, brand scan, and
an independent contract/security review. Publish a source-ready managed Linear
checkpoint only after all local evidence passes; leave the issue In Progress
until GitHub publication is approved and merged.

## Completion Audit

HON-183 is source-ready only when contract tests and broad gates pass, review has
no unresolved material findings, current Send routes still return explicit
`501`, config still advertises disabled, and the managed Linear checkpoint reads
back byte-for-byte. GitHub publication and issue completion remain later gates.
