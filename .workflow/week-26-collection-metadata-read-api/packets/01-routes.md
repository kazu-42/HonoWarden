# Packet 01: Routes

Objective: Add read-only collection metadata routes.

Files:

- `src/app.ts`

Do:

- Add authenticated `GET /api/collections`.
- Add authenticated `GET /api/collections/:id`.
- Keep non-GET collection routes on the existing unsupported response.

Do not:

- Add collection persistence, mutation, assignment, or organization scope.
- Touch external release or deployment state.

Expected output: Read-only collection metadata API implementation.

Verification: App tests and typecheck.
