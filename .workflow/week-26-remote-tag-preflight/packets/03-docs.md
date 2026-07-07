# Packet 03: Docs

## Objective

Make the remote-checked preflight the documented final tag readiness command.

## Contract

- Tagging runbook uses `pnpm release:tag:preflight -- --strict --check-remote`.
- Release gate preflight docs explain when remote tag absence is verified.
- Release index and alpha release notes use the remote-checked command.
- Current state records remote tag absence verification as implemented.
