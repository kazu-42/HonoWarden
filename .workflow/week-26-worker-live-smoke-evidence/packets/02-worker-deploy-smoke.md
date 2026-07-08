# Packet 02: Worker Deploy Smoke

## Objective

Deploy staging and production API Workers from the release target commit and
record live smoke.

## Context

An initial deploy was run from `main`
`392637b3e277ba35057ba461cd82fac69013f603`. Runtime diffs existed between that
commit and the release target, so the deploy was corrected.

## Do

- Apply pending production D1 migrations.
- Check out the release target commit.
- Deploy staging and production Workers.
- Query `/health`, `/healthz`, `/health/db`, `/api/config`, and synthetic
  prelogin denial over HTTPS.
- Record deployment IDs, version IDs, and redacted outputs.

## Do Not

- Write secrets.
- Enable public registration.
- Store real vault data.

## Result

Completed. Staging version `bf0333dc-9efa-4001-aa31-20b3e10731c9` and
production version `72577dd9-c859-4673-b653-fbdd796f8f7d` passed live smoke.
