# HON-43 Scheduled Remote Backup Evidence Orchestration

## Sequence

1. Inspect existing backup CLI, release evidence, and known limitations.
2. Move HON-43 to In Progress and post the intended scope in Linear.
3. Add failing tests for scheduled backup packets, workflow shape, argument
   separator handling, and secret-safe backup evidence.
4. Implement `backup:evidence`, `backup:schedule:packet`, and the scheduled
   remote backup workflow.
5. Verify Cloudflare/R2 credential readiness without printing values.
6. Derive R2 S3-compatible credentials from the existing D1/R2 scoped token and
   store them only in ignored home env and GitHub Actions secrets.
7. Run a live remote backup drill with a temporary non-secret R2 object and
   clean it up.
8. Restore into a fresh local persistence target and verify D1/R2 readback.
9. Update runbooks, release evidence, known limitations, current state, and
   tests.
10. Run local gates, open PR, wait for CI, merge, dispatch or observe the
    workflow when available, and update Linear.

## External Writes

- Linear issue state/comment updates for HON-43.
- GitHub repository secrets for the scheduled backup workflow.
- Temporary production R2 object creation and deletion for the non-secret drill.
- GitHub PR creation and merge after CI passes.

## Safety Rules

- Backup archives stay under ignored `test/.tmp` during local drills.
- Secret values are never printed.
- Production restore is never performed.
- Temporary R2 drill data is non-secret and deleted after capture.
