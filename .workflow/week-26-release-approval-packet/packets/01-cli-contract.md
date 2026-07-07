# Packet 01: CLI Contract

## Objective

Create a read-only approval packet that summarizes whether the alpha tag can be
approved by an operator.

## Files

- `scripts/honowarden-release-approval-packet.mjs`
- `package.json`

## Do

- Compose the strict release gate, remote tag preflight, GitHub release plan,
  CI evidence, and commit alignment into one JSON report.
- Emit exact tag approval text for the current `HEAD`.
- Exit non-zero in strict mode when any required check fails.

## Do Not

- Create or push tags.
- Create, update, publish, or delete GitHub releases.
- Deploy.

## Expected Output

`pnpm release:approval:packet` prints a machine-readable report with
`status`, `checks`, `commands`, `approvalText`, and explicit limitations.
