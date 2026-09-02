# Release Gate Preflight

Target: `v0.1.0-alpha`.

Historical status: the already-published `v0.1.0-alpha` tag resolves to commit
`e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`. The release gate now provides a
read-only repository audit with two explicit layers: mutable current-tree
release evidence and the hash-sealed tag-time client archive. A `ready` result
does not authorize retagging, republishing, or deployment.

Run the repository-local audit with:

```sh
pnpm release:gate
```

The command is read-only. It checks repository evidence and prints JSON with:

- `scope: "repository_release_evidence"`: the report audits repository
  evidence and is not a deployment decision
- `evidenceStatus`: `consistent` or `inconsistent`
- `executionStatus: "not_admitted"`: Worker writes remain unavailable
- `layers.currentTree`: checks evaluated against mutable current `HEAD`,
  including current migrations, lockfile, documents, and recorded evidence
- `layers.publishedAlphaArchive`: only the hash-sealed tag-time client matrix
  and its archived CLI evidence
- `pass`: evidence exists and is locally consistent
- `block`: current-tree evidence or the sealed archive is incomplete or
  inconsistent

The legacy `overall: "ready"` value means only that both repository-evidence
layers are internally consistent. It does not claim that current `HEAD` is the
published tag, and it does not override `executionStatus`.

Use strict mode when a non-zero exit is required for an inconsistent audit:

```sh
pnpm release:gate -- --strict
```

Strict mode exits non-zero while any blocking check remains.

## Historical Tag Procedure

Before the original alpha tag was created, the operator also ran this local tag
preflight on the release commit:

```sh
pnpm release:tag:preflight -- --strict --check-remote
```

The command is retained as historical procedure. It checks that the package
version matches the alpha target, the strict release gate passes, the working
tree is clean, and the local and remote tag do not already exist. Because the
tag now exists, this is not a current publication path and must not be used to
move, recreate, or replace it.

Use [Alpha Tagging Runbook](tagging-runbook.md) for the explicit approval gate,
remote read-only check, tag commands, verification, and failure handling.

## What It Proves

The current-tree layer proves repository-local facts about the checkout being
audited:

- release docs exist
- package version matches `0.1.0-alpha`
- migration freeze hashes match migration files
- dependency audit evidence matches the current lockfile hash
- required Week 20 through Week 26 workflow states are complete and include CI
  evidence
- current migration freeze hashes match the current migration files; these may
  include post-tag migrations and are not attributed to the published alpha
- current dependency audit evidence matches the current lockfile hash
- required historical workflow and operations evidence remains present
- staging dry-run and Cloudflare resource records retain explicit historical,
  non-authority boundaries
- the Linear seed is structurally valid

The published-alpha archive layer proves only that:

- the immutable alpha snapshot reconstructs the client matrix from tag commit
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`, with source-matrix SHA-256
  `8076ec9d4fd9179b9f0616f6f6b5489acacae291058ba95854e4591be56c3491`
- the tag-time CLI `2026.6.0` login, sync, revision, and item-lifecycle evidence
  matches the byte count and SHA-256 in the manifest at
  `docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md`

## What It Does Not Prove

The preflight does not contact Cloudflare, GitHub, Linear, package registries, or
official clients. It does not tag a release and does not deploy.

The tag preflight also does not create or push a Git tag or publish a GitHub
release. Remote tag absence is verified only when `--check-remote` is supplied.
External write actions remain explicit operator steps after CI passes on the
release commit.

The preflight still does not prove full browser, desktop, Android, iOS, TOTP, or
item-mutation behavior through real clients. Those remain compatibility limits
until separate evidence is recorded.

The historical gate does not include post-tag Browser, Desktop, Android, or CLI
TOTP/recent-auth evidence, and it does not promote any current 2026.7 row.

The remote backup evidence proves a manual live remote backup drill and a
scheduled workflow contract. It does not prove that the post-merge scheduled
workflow has already produced its first artifact or that a remote disposable
Cloudflare restore target has been exercised.

## Expected Current Result

The expected repository-local result is `ready` while the current-tree checks
and the sealed published-alpha archive both remain internally consistent.
Current-tree success must not be attributed to the historical tag. Because
`v0.1.0-alpha` is already published, this is an audit result only. It is not
approval to move the tag, republish the release, or deploy. Any future release
must use a new release target and fresh exact-version client evidence.
