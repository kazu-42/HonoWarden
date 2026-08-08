# ADR 0009: Premium Surface Scope

## Status

Accepted

## Context

Official clients use broad account premium state to reveal multiple product
surfaces. The pinned browser extension does not expose a server-capability field
that can keep Emergency Access, vault breach lookup, or file Sends hidden while
the account remains premium. Organization Send policies are not a substitute:
they disable text Sends as well and describe organization policy rather than
server capability.

HonoWarden does not implement the delegated authorization state machine required
by Emergency Access, the server-side account lookup required by the bundled HIBP
service, or active Send metadata and public sharing. ADR 0011 accepts a future
Send product line and supersedes ADR 0003's permanent exclusion, but explicitly
preserves this runtime guard until the stateful, public-control, operational, and
live-evidence gates pass. ADR 0004 still excludes Emergency Access.
Returning the general route catch-all for any of these calls would make an
intentional product boundary look like an accidental missing route.

The client treats `400`, `404`, and `501` as finite errors and retries none of
them. A `404` from an Emergency Access attachment lookup is unsafe as an
unsupported signal because the client interprets it as permission to try a
cached attachment URL. The client reads a top-level `Message` for user-facing
errors and does not read HonoWarden's nested `error.message` field.

## Decision

Keep these premium surfaces intentionally unsupported:

- all Emergency Access operations, including the pinned client's
  `GET /api/emergency-access/trusted` key-rotation preflight and
  `GET /api/emergency-access/:emergencyAccessId/:cipherId/attachment/:attachmentId`
  download-URL lookup;
- the server-origin vault breach lookup at `GET /api/hibp/breach`;
- all Send and public-sharing operations under `/api/sends` and
  `/api/sends/*`, including file metadata creation, direct upload, signed-URL
  renewal, public download metadata, update, password removal, and delete, plus
  the `send_access` grant at `POST /identity/connect/token` that precedes V2
  public Send access.

When the optional global request quota is enabled, its ingress check runs first
and may perform its shared D1 quota write. The route then returns HTTP `501`
before route-specific authentication, Send-specific database work, or
object-storage work with this contract:

```json
{
  "Message": "This feature is unavailable on this server.",
  "error": {
    "code": "unsupported_feature",
    "message": "This feature is unavailable on this server."
  },
  "requestId": "request-id"
}
```

The top-level `Message` is a compatibility alias for official-client error
rendering. The nested structural code remains the stable HonoWarden contract.
Do not return an empty-list or successful-looking stub: it could let a client
continue into a state transition or file upload and would misrepresent support.

Weak-password and reused-password evaluation in the pinned extension is local.
Its manual exposed-password check calls the external Pwned Passwords range API
directly. Those flows do not add HonoWarden routes. TOTP remains client-side, and
cipher-scoped attachment routes are outside this decision and remain governed by
their existing authenticated contract.

## Consequences

- Premium clients receive an explicit, client-readable unavailable error instead
  of the incidental `404 not_found` catch-all or a working-looking stub.
- File Send creation stops before any upload begins, and unsupported calls do not
  create D1 or R2 state.
- The pinned client blocks account-key rotation when its
  `/emergency-access/trusted` preflight is unavailable. This incompatibility is
  explicit rather than hidden by an empty-list response.
- The pinned attachment action clears its loading state and displays the server
  message on `501`, but its upstream RxJS action wrapper can also report the
  rejected promise to the global error handler. A `404` is not used because it
  activates cached-URL fallback behavior.
- ADR 0011 defines the future Send product line. Its HON-184/HON-185 stateful
  slices remain hidden behind this guard, and only HON-186 may replace it after
  quotas, audit, cleanup, kill-switch, rollback, and live compatibility gates
  pass. Until then, reverting this guard would be a security regression.
- Reverting the current guard requires no data migration because it persists no
  state. Later Send rollback follows ADR 0011 and is separately evidenced.
- No compatibility verification level is promoted by this decision.
