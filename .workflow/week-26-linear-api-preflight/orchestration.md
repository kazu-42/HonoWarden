# Orchestration: Week 26 Linear API Preflight

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If `LINEAR_API_KEY` is missing, report `not_ready` without network access.
- If `LINEAR_API_KEY` contains unsupported control characters, report
  `not_ready` before network access.
- If a custom GraphQL endpoint is configured, report `not_ready` before sending
  the API key.
- If a local workspace slug override disagrees with the seed, report
  `not_ready` before network access.
- If the seed omits `workspaceSlug`, report `not_ready` before network access.
- If the seed omits `team.key` or `team.name`, report `not_ready` before
  network access.
- If GraphQL returns HTTP failure or an `errors` array, report `not_ready`.
- If the organization `urlKey` is not `honowarden`, block all live writes.
- If the `HW` / `HonoWarden` team or required workflow state types are missing,
  block issue application.
- Treat project-scoped views as manual inventory entries unless a future query
  can verify them directly.

## Packet Prompts

### 01-script

Implement `scripts/honowarden-linear-preflight.mjs` and expose it as
`pnpm linear:preflight`. Use the Linear GraphQL API read-only, accept `--strict`
and `--seed`, and do not print secrets.

### 02-tests-docs

Add tests with a mocked GraphQL fetch implementation and update the
operator/Linear tracking docs so future sessions can distinguish local seed
validation from live workspace preflight.

## Completion Audit

- Confirm no Linear mutation tools were called.
- Confirm tests exercise missing key, malformed API key rejection, custom
  endpoint rejection, alternate endpoint ports, workspace environment mismatch,
  malformed seed workspace, malformed seed team, auth failure, workspace
  mismatch, team mismatch, ready state, view status type mismatch, strict mode,
  and secret redaction.
- Confirm the workflow artifact passes verification.
