# Orchestration: HON-50 operator metrics alerts

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If the CLI test fails because the packet exposes raw identifiers, stop and
  reduce the output surface before adding more docs.
- If docs still claim operator metrics or alerting are missing, update the
  current-state and limitations wording before PR.
- If any production deploy, remote D1 mutation, or external alert sink setup is
  needed, pause for explicit approval.
- If broad checks fail outside the touched surface, isolate whether the failure
  is caused by this branch before changing unrelated files.

## Packet Prompts

Packet A:
Implement cleanup candidate metric queries in
`scripts/honowarden-abuse-report.mjs` for auth attempts, auth failure buckets,
TOTP challenges, audit events, and request quota buckets. Keep dry-run output
secret-safe and avoid live D1 mutation unless `--execute` is supplied.

Packet B:
Add alert classifications for active blocked quota buckets, active locked auth
failure buckets, cleanup backlog, and repeated scheduled cleanup failure.
Include warning/critical thresholds and first-response actions.

Packet C:
Update `docs/operations/request-quotas.md`,
`docs/operations/retention-cleanup.md`, `docs/current-state.md`, and
`docs/security/known-limitations.md` so they point at the CLI packet and keep
external notification/dashboard wiring as a separate remaining gap.

Packet D:
Run focused tests, broad repo checks, release gate, workflow verifier, PR CI,
merge, main CI, and then close HON-50 in Linear with evidence.

## Completion Audit

- Linear HON-50 is In Progress before implementation.
- Red test captured missing alert/retention fields before the fix.
- Local CLI dry-run emits expected query and alert IDs.
- PR and main CI are green before Linear Done.
