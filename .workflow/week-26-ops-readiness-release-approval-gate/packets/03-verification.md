# Packet 03: Verification

## Objective

Prepare verification expectations without executing commands so this workflow
artifact reflects safe-local status and explicit pending readiness.

## Files

- `.workflow/week-26-ops-readiness-release-approval-gate/state.json`
- `.workflow/week-26-ops-readiness-release-approval-gate/final-report.md`

## Do

- Mark verification status as `in_progress` with pending check entries.
- Keep check list explicit and safe, without fabricated pass/fail output.
- Preserve packet constraints and blockers in final evidence.

## Do Not

- Execute verification commands or claim run outcomes.
- Introduce any external service writes.

## Expected Output

- Packet and state show verification as in progress and ready for main-agent
  evidence collection.
