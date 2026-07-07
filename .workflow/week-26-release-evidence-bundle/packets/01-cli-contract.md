# Packet 01: CLI Contract

## Objective

Create a read-only pre-tag evidence bundle for alpha tag approval.

## Files

- `scripts/honowarden-release-evidence-bundle.mjs`
- `package.json`

## Do

- Compose existing release gate, tag preflight, approval packet, post-tag
  preview, and brand scan evidence.
- Emit commands and approval text only when the bundle is ready.
- Support explicit local `--output` writing with overwrite protection.

## Do Not

- Create, move, delete, or push tags.
- Create, update, publish, or delete GitHub releases.
- Deploy.

## Expected Output

`pnpm release:evidence:bundle` prints a machine-readable pre-tag evidence JSON
report.
