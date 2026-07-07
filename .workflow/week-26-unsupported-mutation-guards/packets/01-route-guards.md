# Packet 01: Route Guards

Objective: Add explicit unsupported responses for alpha-out-of-scope mutation
surfaces.

Files:

- `src/app.ts`

Do:

- Route scoped-out surfaces to the existing unsupported alpha response.
- Keep route patterns narrow enough to avoid supported route interception.
- Avoid D1/R2/secrets access.

Do not:

- Implement attachment, collection, emergency-access, or device trust/key
  behavior.
- Publish, deploy, mutate tags, or edit external release state.

Expected output: Route definitions only, using the existing response helper.

Verification: `test/app.test.ts` route coverage and full app test run.
