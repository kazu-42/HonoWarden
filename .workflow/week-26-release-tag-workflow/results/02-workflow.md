# Result 02: Workflow

## Accepted

- Added `.github/workflows/release-tag.yml`.
- The workflow runs on `v0.1.0-alpha` tag pushes.
- The workflow uses `contents: read`.
- The workflow runs release-critical checks and a repository brand scan.

## Rejected

- Did not create or push a tag.
- Did not publish a release.
- Did not deploy.
