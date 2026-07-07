# Packet 01: Profile Route

Objective: Add a read-only authenticated account profile route.

Files:

- `src/app.ts`

Do:

- Add `GET /api/accounts/profile`.
- Use the existing bearer authentication helper.
- Extract shared profile metadata so sync and account profile stay aligned.
- Include unlock metadata using the existing token response shape.

Do not:

- Add mutation, account lifecycle, external writes, or new storage.

Expected output: Read-only route and shared response builder.

Verification: App route tests and typecheck.
