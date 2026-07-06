Packet ID: 03-route-integration
Objective: Integrate login defenses into password grant.
Context: The token endpoint should enforce defenses while keeping safe generic wording.
Files / sources: `src/app.ts`, `test/app.test.ts`.
Ownership: HTTP boundary integration.
Do: Check IP bucket before auth lookup, record failed attempts, lock accounts on repeated wrong passwords, reset state on success, return generic errors.
Do not: Change successful token response shape or reveal whether a user exists.
Expected output: App route tests prove lockout/rate limit behavior.
Verification: App route tests.
