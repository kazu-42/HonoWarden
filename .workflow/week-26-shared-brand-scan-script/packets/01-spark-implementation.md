# Packet 01: Spark Implementation

Objective: centralize repository brand scan in a shared package script.

Ownership:

- `scripts/honowarden-brand-scan.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-tag.yml`
- focused tests under `test/ops/`

Do:

- Implement a Node standard-library scanner with the existing workflow
  exclusions.
- Add `pnpm brand:scan`.
- Update both workflows to call `pnpm brand:scan`.
- Add focused tests for clean and constructed blocked content.

Do not:

- Store the blocked provider-brand token contiguously.
- Edit app source, release scripts, lockfiles, migrations, or docs.
- Run broad QA.

Expected output: a small shared scan patch ready for main-agent QA.
