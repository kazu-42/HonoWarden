# Orchestration: Week 26 CLI Item Live Smoke

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If login fails, fix login compatibility before attempting item mutation.
- If item create fails on an unimplemented route, add the smallest route or
  response-shape change needed for the tracked CLI and cover it with tests.
- If update/delete flows are not reachable within this loop, record create/sync
  evidence and leave a precise follow-up instead of overstating coverage.
- If any command emits a token, session key, password hash, or generated key
  material, keep it in ignored `test/.tmp/` only and never copy it into docs.

## Packet Prompts

### 01 Local Smoke Setup

Prepare local wrangler dev, local D1, synthetic account bootstrap, and the local
HTTPS proxy. Expected output: local endpoint ready and login can be attempted.

### 02 CLI Mutation Discovery

Run the tracked CLI item commands with synthetic item data. Expected output:
exit codes, route list, and redacted stdout/stderr summaries.

### 03 Compatibility Implementation

Patch HonoWarden for confirmed protocol gaps only. Expected output: code,
fixtures, and tests that explain the behavioral contract.

### 04 Evidence And Verification

Update evidence and run local gates, scans, push, and CI. Expected output:
workflow final report and CI run ID.

## Completion Audit

- Workflow state is `completed`.
- Verification status is `passed`.
- Final report lists accepted results, skipped limits, and CI evidence.
