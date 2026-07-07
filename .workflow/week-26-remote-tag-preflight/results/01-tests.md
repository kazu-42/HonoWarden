# Result 01: Tests

## Accepted

- Added focused coverage for `--check-remote --remote <temp-remote>`.
- The test uses a temporary bare Git repository instead of the network.
- The test asserts `remote_tag_absent` and the updated limitation text.
- Added strict-mode failure coverage for a temporary remote repository that
  already contains `v0.1.0-alpha`.

## Evidence

- Initial focused test failed with `Unknown option: --check-remote`.
- Focused test passed after script implementation.
