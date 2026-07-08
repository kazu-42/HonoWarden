# Packet 03: Readiness And Rollback

## Objective

Update operations readiness and rollback evidence after API Worker live smoke.

## Do

- Mark Worker live smoke evidence `passed`.
- Keep rollback evidence `partial` unless rollback is rehearsed or executed.
- Record previous Worker version IDs as candidate handles when they are not
  verified safe rollback targets.
- Leave approved rollback commands unresolved unless a verified safe target is
  selected.
- Run ops readiness and capture the next blocker.

## Do Not

- Mark website, Email Routing, or rollback evidence passed from API Worker
  smoke.

## Result

In progress. Candidate previous-version handles are recorded. Ops readiness
readback still needs to be run after formatting and evidence updates.
