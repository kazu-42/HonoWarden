# Packet 02: Implementation

## Objective

Add a read-only release published packet script and package script.

## Context

The script runs after publication. It verifies the tag, tag verification
workflow, release gate, published prerelease state, target commit, and
release-note body.

## Files / Sources

- `scripts/honowarden-release-published-packet.mjs`
- `package.json`
- existing release packet scripts under `scripts/`

## Ownership

Main agent.

## Do

- Emit JSON with `status`, checks, existing release metadata, view command,
  verification text, and limitations.
- Exit non-zero in `--strict` mode when not ready.
- Default the target commit to the release tag commit.
- Keep command execution read-only.

## Do Not

- Publish, update, or delete a GitHub Release.
- Create, move, delete, or push Git tags.
- Deploy or mutate Cloudflare state.

## Expected Output

`pnpm release:published:packet` produces a ready/not-ready JSON report.

## Verification

`pnpm release:published:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
