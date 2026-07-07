# Packet 03: Docs And Workflow

## Objective

Record the approval packet in operator-facing docs and workflow evidence.

## Files

- `docs/release/tagging-runbook.md`
- `docs/current-state.md`
- `.workflow/week-26-release-approval-packet/*`

## Do

- Make the tagging runbook require a ready approval packet before requesting
  operator approval.
- Document implemented and intentionally unimplemented release actions.
- Capture approval boundaries and verification evidence in workflow artifacts.

## Do Not

- Treat docs as approval to create or push the tag.
- Remove existing release-gate requirements.

## Expected Output

Operators can inspect one packet, copy the exact approval text, and see which
external writes remain blocked.
