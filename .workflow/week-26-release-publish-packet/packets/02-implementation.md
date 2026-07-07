# Packet 02: Implementation

## Objective

Add a read-only release publish packet script and package script.

## Context

The script runs after a draft prerelease is created. It must verify the local
and remote tag, tag verification workflow run, release gate, existing draft
release state, target commit, prerelease flag, and release-note body.

## Files / Sources

- `scripts/honowarden-release-publish-packet.mjs`
- `package.json`
- existing release packet scripts under `scripts/`

## Ownership

Main agent.

## Do

- Emit JSON with `status`, checks, existing release metadata, commands,
  approval text, and limitations.
- Exit non-zero in `--strict` mode when not ready.
- Keep command execution read-only.
- Match the style of existing release packet scripts.

## Do Not

- Publish, update, or delete a GitHub Release.
- Create, move, delete, or push Git tags.
- Deploy or mutate Cloudflare state.

## Expected Output

`pnpm release:publish:packet` produces a ready/not-ready JSON report.

## Verification

`pnpm release:publish:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
