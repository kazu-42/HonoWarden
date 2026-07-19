# Orchestration: HON-203 password verification and change

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- Worktree: `/Users/hackhike/dev/HonoWarden-hon-203-password-change`.
- Branch: `feat/hon-203-password-change` from current `main`.
- Keep other active worktrees untouched.
- Delete this worktree only after merged-main and Linear closeout readback.

## Packet Prompts

- `01-official-contract.md`: derive only pinned request/response facts from
  official upstream repositories and record source paths/tags.
- `02-security-boundary.md`: identify invariants, mutation ownership, failure
  ordering, and rollback behavior in the current HonoWarden implementation.
- `03-tdd-implementation.md`: add failing tests first, implement the smallest
  coherent domain/repository/route changes, and refactor after green.
- `04-real-d1-lifecycle.md`: exercise migrations and a complete synthetic
  old/new credential lifecycle through the actual Worker route surface.
- `05-docs-evidence.md`: update only capability claims supported by tests and
  exact evidence; distinguish source support from live production support.
- `06-independent-review.md`: review the exact commit for issue fit, solution
  correctness, architecture quality, repo rules, and regression/test risk.

## Completion Audit

- All packet evidence has an exact commit or file reference.
- No unresolved review finding remains.
- Candidate tree equals merged tree; both candidate and main CI are green.
- HON-203 is Done and archived only after merge and Linear checkpoint readback.
- Parent HON-160 and downstream blocked issues are refreshed without claiming
  production rollout.
