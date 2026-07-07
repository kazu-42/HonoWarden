# Packet 02: Evidence And Docs

Objective: update current-state documentation and workflow evidence for the
fixture replay invariant.

Context:

- `docs/current-state.md` and `docs/compatibility-matrix.md` had older wording
  from the stateless-only replay phase.
- The release remains draft-publication approval gated.

Files:

- `docs/current-state.md`
- `docs/compatibility-matrix.md`
- `.workflow/week-26-fixture-replay-coverage-invariant/**`

Do:

- Document that route replay enumerates all fixture JSON files.
- Document that the replay set is compared with `compat/fixture-flows.json`.
- Record local verification and later CI evidence.

Do not:

- Publish the release.
- Move tags or mutate external infrastructure.

Expected output: project status reflects the enforceable fixture replay gate.
