# Orchestration: Week 20 Backup Restore

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a Wrangler command supports a flag in one subcommand but not another, split command-specific flag builders and cover the behavior with tests.
- If restore execution cannot prove a target is fresh, require explicit operator confirmation and document the remaining hazard.
- If an object inventory cannot be derived safely, require an explicit R2 object list and document incomplete-list risk.
- If manifest validation is incomplete, prefer fail-closed restore execution over a permissive restore plan.

## Packet Prompts

### 01-backup-cli

Objective: add operator backup/restore command planning.

Do: create CLI wrapper scripts, package scripts, manifest generation, dry-run output, D1 export/import command planning, and R2 object get/put command planning from explicit object lists.

Do not: add a public API route or store real backup data in fixtures.

### 02-restore-safety

Objective: make restore execution fail closed before side effects.

Do: validate manifest paths, reject traversal, scope Wrangler flags correctly, require fresh target confirmation, and verify checksums before restore `--execute`.

Do not: trust manifest file paths or allow restore execution without operator acknowledgement.

### 03-runbook-workflow

Objective: record the Week 20 operational contract and verification evidence.

Do: add backup/restore runbook, current-state increment, workflow packets/results/final report, local gates, brand scan, workflow verifier, push, and CI evidence.

## Completion Audit

Completion requires local gates, repository brand scan, workflow verifier, and CI. Live remote backup/restore drills are out of scope for this local slice and remain a recorded risk.
