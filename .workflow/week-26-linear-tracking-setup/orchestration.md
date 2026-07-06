# Week 26 Linear Tracking Orchestration

## Goal

Keep Linear tracking useful while preventing cross-workspace writes.

## Sequence

1. Inspect the available Linear MCP workspace and browser access.
2. Confirm the existing seed covers projects, issues, views, and Pulse.
3. Update stale Pulse/status text to match Week 25 completion.
4. Add a package script and README link.
5. Update operations docs with the current access guard.
6. Run local gates, brand scans, workflow verifier, push, and wait for CI.
7. Record CI evidence.

## External Writes

No live Linear writes are allowed in this workflow because the current connector
does not resolve to the `honowarden` workspace.

## Verification Policy

Fail the workflow if the seed does not validate, if tests fail, if brand scans
find excluded strings, if docs imply live Linear setup was completed, or if CI
fails.
