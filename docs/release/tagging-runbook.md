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

Do not proceed if any of these are true:

- the working tree is dirty
- the local tag already exists
- the remote tag already exists
- CI is pending, failed, skipped, or for a different commit
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

## Failure Handling

If local tag creation succeeds but push has not happened yet, delete only the
local tag and rerun the preconditions:

```sh
git tag -d v0.1.0-alpha
```

If the tag was pushed to the wrong commit, treat that as a release incident.
Do not silently retag. Record the wrong tag SHA, the intended SHA, the commands
that were run, and the time of discovery. Deleting or replacing a pushed tag is
a separate operator-approved corrective action:

```sh
git push origin :refs/tags/v0.1.0-alpha
git tag -d v0.1.0-alpha
```

Only run those corrective commands after approval, because downstream users and
automation may already have observed the pushed tag.

## Post-Tag Follow-Up

After the pushed tag is verified:

- create release notes from `docs/release/v0.1.0-alpha-release-notes.md`
- keep pre-alpha safety language unless a separate readiness decision changes it
- do not deploy production from the tag without a separate deployment approval
- record the tag SHA, CI run URL, and any manual checks in the release tracker
