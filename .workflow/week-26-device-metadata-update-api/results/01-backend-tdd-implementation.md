# Result 01: Backend TDD Implementation

Status: local implementation passed.

- Added RED tests for repository metadata update behavior and HTTP route
  behavior.
- Implemented `updateDeviceMetadata` with owner-scoped active-device lookup.
- Added authenticated `PUT /api/devices/:id` route.
- Preserved unsupported behavior for `PATCH /api/devices/:id`, key update, and
  trust update routes.
- Focused repository and app tests passed.
