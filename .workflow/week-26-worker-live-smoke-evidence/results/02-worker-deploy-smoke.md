# Result 02: Worker Deploy Smoke

Accepted.

- Production D1 migrations `0001`, `0002`, and `0003` were applied and then
  rechecked as no longer pending.
- Staging was deployed from the release target:
  `ae336be4-169b-4a8a-a8c7-8d4b8ab7fa32`,
  `bf0333dc-9efa-4001-aa31-20b3e10731c9`.
- Production was deployed from the release target:
  `24f81b98-b761-4faa-aa78-cd773bb5d0c1`,
  `72577dd9-c859-4673-b653-fbdd796f8f7d`.
- Staging and production live smoke passed for `/health`, `/healthz`,
  `/health/db`, `/api/config`, and denied synthetic prelogin behavior.

Rejected.

- Initial deployments from `main`
  `392637b3e277ba35057ba461cd82fac69013f603` were not accepted as alpha deploy
  evidence because the published release target was different.
