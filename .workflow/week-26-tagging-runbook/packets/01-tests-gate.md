# Packet 01: Tests And Gate

## Objective

Make the tagging runbook part of release readiness.

## Contract

- `test/release-docs.test.ts` requires `tagging-runbook.md`.
- The release gate required-doc list includes `tagging-runbook.md`.
- Tests assert tag creation remains explicitly operator-approved.
