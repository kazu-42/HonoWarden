# Packet 01: Routes

Objective: Add read-only metadata routes for policy and domain state.

Files:

- `src/app.ts`

Do:

- Add authenticated policy list routes.
- Add authenticated domain metadata routes.
- Share domain response shape with sync.

Do not:

- Add policy management, policy enforcement, custom domain settings, or
  organization scope.
- Touch external release or deployment state.

Expected output: Read-only metadata API implementation.

Verification: App tests and typecheck.
