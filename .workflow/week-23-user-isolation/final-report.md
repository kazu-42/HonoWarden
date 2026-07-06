# Final Report: Week 23 User Isolation

## Outcome

Week 23 user-isolation evidence is implemented locally. The production app code
already used owner-scoped repository calls, so this slice strengthens tests and
FakeD1 fidelity rather than changing route behavior.

## Accepted Results

- Disabled password grants fail with generic invalid-grant wording.
- Disabled refresh grants fail before token rotation.
- Mixed Alice/Bob sync tests prove folder and cipher rows are isolated by the
  authenticated user id.
- FakeD1 can model multiple auth users and user-bound list queries.
- Current-state notes record Week 23 scope and gaps.

## Rejected Results

- Live dogfood account setup was not performed.
- Production data or external service configuration was not touched.
- Shared vault, Organization, and Send behavior remains out of initial scope.

## Conflicts Resolved

- Kept production code unchanged because the real SQL predicates already bind
  `user_id`; the gap was test evidence and fake database fidelity.

## Verification Evidence

- `pnpm test -- test/app.test.ts -t "disabled|isolated"`
- `pnpm test -- test/app.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm compat:test`
- `pnpm format`
- repository brand scan: no content hits
- repository path brand scan: no path hits
- workflow verifier: passed
- GitHub Actions CI: pending

## Remaining Risks

- Local HTTP tests do not replace live two-user dogfood evidence.
- FakeD1 still models only the query shapes used in tests.
- Disabled account admin operations and automated lifecycle tooling remain
  future work.

## Reusable Follow-up

- Use `authUsers` in future tests that need multiple account boundaries.
- Add live dogfood evidence only with synthetic vault data and an external
  operations gate.
