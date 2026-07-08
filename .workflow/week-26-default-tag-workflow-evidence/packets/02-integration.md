# Packet ID: 02-integration

Objective:

Wire default tag workflow evidence into read-only release and operations packet
commands.

Ownership:

- `scripts/honowarden-release-publish-packet.mjs`
- `scripts/honowarden-release-published-packet.mjs`
- `scripts/honowarden-release-status-packet.mjs`
- `scripts/honowarden-alpha-completion-audit.mjs`
- `scripts/honowarden-ops-readiness-packet.mjs`
- focused tests under `test/ops/`

Do:

- Resolve defaults after parsing CLI options.
- Preserve explicit `--tag-workflow-*` values.
- Add `--no-default-tag-workflow-evidence` for strict missing-evidence tests.

Do not:

- Publish a release, mutate tags, deploy, change DNS/email routing, send email,
  or write secrets.

Status:

in progress.
