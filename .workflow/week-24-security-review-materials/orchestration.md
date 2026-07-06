# Week 24 Orchestration

## Goal

Produce alpha security review materials that are explicit, reviewable, and
tested for presence.

## Sequence

1. Inspect routes, schema, config, operations docs, and security policy.
2. Run dependency audit.
3. Add `docs/security/**`.
4. Add CI-backed security docs test.
5. Update current-state and workflow evidence.
6. Run full local gates, push, wait for CI, and record evidence.

## Sidecar Review

A Spark xhigh red-team sidecar reviews the document scope while the main thread
writes and verifies the docs.

## Verification Policy

Fail the workflow if the docs imply independent audit completion, omit known
pre-alpha limitations, fail CI, or introduce excluded brand strings.
