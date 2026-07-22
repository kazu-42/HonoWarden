# EVIDENCE-1A: Credential Evidence Contract

Linear issue: HON-227

## Objective

Define one machine-readable registry that binds every credential claim to its
exact evidence level, source generation, artifacts, client pins, and residual
limitations.

## Ownership

- formal closed JSON Schema and canonical registry
- exact `fixture`, `local_api`, `local_official_client`, `staging`, and
  `production` level ordering
- password, KDF, account-key, user-key, backup, restore, disabled-route, and
  forward-recovery claims
- canonical tracked artifact paths and exact content markers
- source-generation and official-client consistency validation

## Invariants

- A lower-level artifact cannot satisfy a higher-level claim.
- Official-client claims identify exact pinned source and asset metadata and
  state the API execution boundary separately.
- Staging and production claims require matching environment evidence; this
  packet adds neither.
- Artifact paths are canonical, tracked, symlink-free regular files contained
  by the repository.
- CLI output contains bounded counts and limitations only, never artifact
  contents or claim markers.

## Verification

- red/green focused contract tests
- schema/validator agreement
- missing, duplicate, inflated, stale, untracked, path-escaping, marker-drift,
  and client-source rejection fixtures
- compatibility impact, full suite, static gates, exact-head standard review,
  and independent five-axis review

## Exclusions

No packet generation, broad document reconciliation, deployment, remote
resource, real credential, production or staging activation, destructive
operation, paid action, or third-party contact.
