# Packet 02: Tests & Docs

## Objective

Record testing and workflow documentation requirements for the new publication
approval gate semantics while preventing accidental conflation with external writes.

## Files

- `.workflow/week-26-ops-readiness-release-approval-gate/plan.md`
- `.workflow/week-26-ops-readiness-release-approval-gate/final-report.md`
- `.workflow/week-26-ops-readiness-release-approval-gate/orchestration.md`

## Do

- Describe verification commands and readbacks as planned/pending items in plan/final report.
- Document explicit constraints: no release publication, no tag mutation, no
  Cloudflare deploy/DNS/Email Routing writes, no email sends, no secret writes.
- Keep references to verification as placeholders (`<run-id>`, `<run-url>`) to avoid
  inventing external IDs.

## Do Not

- Run actual QA/check commands in this workflow artifact pass.
- Add real CI run IDs or external run URLs.
- Add text that implies production actions have occurred.

## Expected Output

- The docs and final report consistently describe how release publication approval
  gates ops readiness and what remains pending until verification.
