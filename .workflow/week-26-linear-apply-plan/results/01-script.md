Result: completed

Implemented `scripts/honowarden-linear-apply-plan.mjs` and
`pnpm linear:apply-plan`.

The command is local-only. It reads the checked-in seed and, optionally, a saved
preflight report. It does not read credentials, does not call `fetch`, and does
not mutate Linear.

The current default output is blocked with
`linear_preflight_report_missing`, with all 55 seed operations marked
`pending_preflight`.
