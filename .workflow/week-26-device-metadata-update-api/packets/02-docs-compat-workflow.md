# Packet 02: Docs Compat Workflow

Objective: document and fixture-cover the device metadata update route.

Files:

- `compat/client-matrix.json`
- `compat/fixture-flows.json`
- `compat/fixtures/devices/update-success.json`
- `docs/current-state.md`
- `docs/compatibility-matrix.md`
- `.workflow/week-26-device-metadata-update-api/**`

Do:

- Add `device_update` fixture coverage.
- Keep live evidence levels unchanged.
- Update known issues so trust/key updates remain the unsupported device
  surface.
- Record local verification.

Do not:

- Claim live client evidence.
- Add this workflow to the release gate before CI evidence exists.
- Publish releases or deploy.
