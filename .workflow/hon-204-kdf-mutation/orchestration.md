# HON-204 orchestration

Goal: ship one fail-closed KDF mutation generation and close HON-204 through
verified merge and Linear readback.

Sequence:

1. Verify immutable upstream source and record only commit/path/contract facts.
2. Write domain and repository tests that fail for the missing behavior.
3. Implement the smallest shared KDF mapping, validation, and guarded commit.
4. Write route/projection lifecycle tests, then integrate the endpoint.
5. Exercise both KDF directions against real local D1 with synthetic secrets.
6. Run the complete repository verification surface.
7. Freeze the candidate head. Run standard review, then a separate five-axis
   review. Any code change invalidates both reviews and restarts this step.
8. Create PR, require exact-head green CI, admin merge, verify merged-main CI,
   close Linear with byte-exact evidence, and remove this worktree.

Branch rules:

- Invalid request, proof-defense failure, stale generation, missing Durable
  Object binding, or any D1 error must not mutate account state.
- Unknown inbound KDF values return a generic invalid-request response.
- Unknown stored KDF values are infrastructure/data-integrity failures and must
  never be projected as a supported algorithm.
- The writer is default-off. Reader support must be deployed and retained as
  the rollback target before a later environment version enables mutation.
- No production action is part of this workflow.
