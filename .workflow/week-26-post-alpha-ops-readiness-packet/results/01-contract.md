Result: 01-contract

- Added `scripts/honowarden-ops-readiness-packet.mjs`.
- Added `ops:readiness:packet` to `package.json`.
- The packet aggregates the alpha completion audit, email local preflight, and
  recorded evidence paths.
- The packet keeps GitHub Release completion separate from Worker deploy,
  website route, Email Routing, live smoke, and rollback evidence.
- The packet limitations state that it does not publish, tag, deploy, change
  DNS, configure email, or send email.
