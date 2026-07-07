# Alpha Tagging Runbook

Target: `v0.1.0-alpha`.

This runbook is for the final operator step after the repository-local release
gate is ready. It does not grant approval by itself. Creating or pushing the tag
is an external release action and requires explicit operator approval.

## Preconditions

Run these checks on the exact commit intended for the tag:

```sh
git status --short
git log -1 --oneline
git tag --list 'v0.1.0-alpha*'
pnpm release:gate -- --strict
pnpm release:tag:preflight -- --strict --check-remote
```

Expected results:

- `git status --short` prints no output.
- `git tag --list 'v0.1.0-alpha*'` prints no output.
- `pnpm release:gate -- --strict` reports `overall: "ready"`.
- `pnpm release:tag:preflight -- --strict --check-remote` reports
  `status: "ready"`.
- GitHub Actions CI is successful for the same commit SHA.
- The repository brand scan has no content or path hits.
- The tag preflight includes `remote_tag_absent` with `status: "pass"`.

## Approval Gate

Before running tag commands, record the release commit SHA, the passing CI run
URL, and the preflight output. Ask the operator to approve creating and pushing
`v0.1.0-alpha` for that SHA.

Use the approval packet to collect those values in one read-only report:

```sh
pnpm release:evidence:bundle -- --strict --ci-run-id <run-id> --ci-url <ci-url> --output docs/release/evidence/v0.1.0-alpha-pre-tag.json
pnpm release:approval:packet -- --ci-run-id <run-id> --ci-url <ci-url>
```

Expected result: both commands report `status: "ready"`. The evidence bundle
collects the release gate, tag preflight, approval packet, post-tag preview,
and repository brand scan in one JSON artifact. The approval packet prints the
exact approval text that must be copied before tag creation and push. It also
verifies the CI run is completed successfully for the current commit SHA.

Do not proceed if any of these are true:

- the working tree is dirty
- the local tag already exists
- the remote tag already exists
- CI is pending, failed, skipped, or for a different commit
- the evidence bundle is missing, was generated for a different commit, or
  reports `not_ready`
- the approval packet is missing or reports `not_ready`
- preflight output was generated without `--check-remote`
- preflight output was generated with `--allow-dirty` or `--allow-existing-tag`
- the operator has not explicitly approved tag creation and push

## Tag Commands

Use the commands printed by
`pnpm release:tag:preflight -- --strict --check-remote`. They should have this
shape:

```sh
git tag -a v0.1.0-alpha <release-commit-sha> -m "v0.1.0-alpha"
git push origin v0.1.0-alpha
```

After pushing, verify the tag points at the approved commit:

```sh
git rev-list -n 1 v0.1.0-alpha
git ls-remote --tags origin v0.1.0-alpha
```

The local and remote commit SHAs must match the approved release commit.
The `Release Tag Verification` GitHub Actions workflow must pass for the pushed
tag before a GitHub release is published or any deployment is approved.

Before creating a GitHub release draft, collect the post-tag release packet:

```sh
pnpm release:post-tag:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>
```

Expected result: `status: "ready"`. The packet verifies local tag context,
remote tag context, the `Release Tag Verification` workflow run, GitHub release
planning, and current release state. Use the printed `createDraft` command only
after the packet prints `draftApprovalText` and the operator explicitly
approves creating the draft.

Before publishing a draft GitHub release, collect the publish packet:

```sh
pnpm release:publish:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>
pnpm release:status:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>
```

Expected result: `status: "ready"`. The packet verifies local tag context,
remote tag context, the tag verification workflow run, release gate readiness,
draft prerelease state, target commit, and release-note body sections. Use the
printed publish command only after the packet prints `publishApprovalText` and
the operator explicitly approves publication.

The status packet summarizes the current phase. Before publication it should
report `phase: "draft_ready_for_publication"` and repeat the same approval
text. After publication it should report `phase: "published_verified"` once the
published packet passes.

The publish packet defaults its target commit to the local tag commit, not the
current branch `HEAD`, because `main` may advance after the release tag is
pushed.

After publishing the GitHub release, collect the published packet:

```sh
pnpm release:published:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>
```

Expected result: `status: "ready"`. The packet verifies the same local tag,
remote tag, tag verification workflow, release gate, target commit, and
release-note body sections, but requires the GitHub release to be no longer a
draft while remaining marked as a prerelease.

## Failure Handling

If local tag creation succeeds but push has not happened yet, delete only the
local tag and rerun the preconditions:

```sh
git tag -d v0.1.0-alpha
```

If the tag was pushed to the wrong commit, treat that as a release incident.
Do not silently retag. Record the wrong tag SHA, the intended SHA, the commands
that were run, and the time of discovery. Before replacing a pushed tag, collect
the read-only recovery packet:

```sh
pnpm release:tag:recovery -- --strict --expected-current-commit <wrong-commit-sha> --recovery-commit <intended-commit-sha> --expected-remote-tag-object <remote-tag-object-sha> --main-ci-run-id <main-ci-run-id> --main-ci-url <main-ci-url> --failed-tag-workflow-run-id <failed-tag-workflow-run-id> --failed-tag-workflow-url <failed-tag-workflow-url>
```

Expected result: `status: "ready"`. The packet verifies the local tag, remote
tag object, peeled remote commit, latest main CI, failed tag workflow, and
absence of an existing GitHub release. It prints an exact approval text and a
`--force-with-lease` push command. Deleting or replacing a pushed tag is still a
separate operator-approved corrective action:

```sh
git push origin :refs/tags/v0.1.0-alpha
git tag -d v0.1.0-alpha
```

Only run those corrective commands after approval, because downstream users and
automation may already have observed the pushed tag.

## Post-Tag Follow-Up

After the pushed tag is verified:

- run
  `pnpm release:post-tag:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- run `pnpm release:github:plan -- --strict --check-remote`
- run
  `pnpm release:publish:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- run
  `pnpm release:status:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- after publication, run
  `pnpm release:published:packet -- --strict --tag-workflow-run-id <run-id> --tag-workflow-url <run-url>`
- create release notes from `docs/release/v0.1.0-alpha-release-notes.md`
- keep pre-alpha safety language unless a separate readiness decision changes it
- do not deploy production from the tag without a separate deployment approval
- record the tag SHA, CI run URL, and any manual checks in the release tracker
