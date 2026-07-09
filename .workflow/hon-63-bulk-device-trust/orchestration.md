# Orchestration: HON-63 bulk device trust

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If route tests show private key material in any response, stop and remove the
  field at `buildDeviceResponse`.
- If a requested bulk device is missing, cross-user, or revoked, return a stable
  not-found error instead of partially presenting success.
- If login-with-device requires pending auth-request or push semantics, keep it
  unsupported unless a full threat model and persistence model are added.
- If compatibility fixtures pass statically but fail route replay, fix the route
  implementation rather than relaxing fixture assertions.

## Packet Prompts

Packet A:
Add an owner-scoped repository operation that resolves every requested active
device by id or identifier, batch-updates opaque encrypted user/public/private
keys, and returns updated `DeviceRecord`s in request order.

Packet B:
Expose `POST /api/devices/update-trust` with authenticated JSON parsing,
duplicate-target rejection, stable 400/401/404/503 responses, and no encrypted
private key in responses. Add explicit unsupported guards for auth-request
routes.

Packet C:
Add a replayed compatibility fixture and update the client matrix, current-state
docs, and security known limitations to record bulk trust support and
login-with-device boundaries.

Packet D:
Run focused, compat, broad repo, release gate, workflow, and GitHub CI checks;
then merge and close Linear with evidence.

## Completion Audit

- HON-63 moved to In Progress before implementation.
- Red tests captured missing repository function and route.
- Focused repository/app/compat checks passed after implementation.
- PR and main CI must pass before Linear Done.
