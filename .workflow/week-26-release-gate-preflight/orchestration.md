# Week 26 Release Gate Preflight Orchestration

## Goal

Make the alpha release gate auditable without performing any external mutation.

## Sequence

1. Inspect release docs, workflow states, compatibility matrix, and audit
   evidence.
2. Add a read-only script that reports pass/block status from repository-local
   evidence.
3. Add strict mode for release automation.
4. Add tests for current `not_ready` behavior.
5. Add release docs and current-state notes.
6. Run local gates, brand scans, workflow verifier, push, and wait for CI.
7. Record CI evidence.

## External Writes

No external writes are allowed. The preflight must not call Cloudflare, Linear,
GitHub, package registries, or external clients.

## Verification Policy

Fail the workflow if the script passes while required live evidence is missing,
if strict mode does not fail with blockers, if release docs overstate readiness,
if brand scans find excluded strings, or if CI fails.
