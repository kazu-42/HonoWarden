# Week 25 Orchestration

## Goal

Make release readiness reviewable and CI-enforced before the alpha tag week.

## Sequence

1. Inspect existing deploy, backup, security, compatibility, and migration docs.
2. Add release docs under `docs/release/`.
3. Add tests for required release docs and migration freeze hashes.
4. Update current-state and README links.
5. Run local gates, brand scans, workflow verifier, push, and wait for CI.
6. Record CI evidence.

## Sidecar Review

A Spark xhigh infra sidecar reviews feature-freeze artifacts and migration
freeze risks while the main thread implements docs and tests.

## Verification Policy

Fail the workflow if migration hashes are stale, docs imply release completion,
brand scans find excluded strings, local gates fail, or CI fails.
