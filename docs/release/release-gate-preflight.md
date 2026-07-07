# Release Gate Preflight

Target: `v0.1.0-alpha`.

Use the release gate preflight before tagging:

```sh
pnpm release:gate
```

The command is read-only. It checks repository evidence and prints JSON with:

- `pass`: evidence exists and is locally consistent
- `block`: alpha tagging must not proceed until the item is resolved

Run strict mode in release automation:

```sh
pnpm release:gate -- --strict
```

Strict mode exits non-zero while any blocking check remains.

Before creating the alpha tag, run the local tag preflight on the release
commit:

```sh
pnpm release:tag:preflight -- --strict
```

The tag preflight is also read-only. It checks that the package version matches
the alpha target, the strict release gate passes, the working tree is clean, and
the local tag does not already exist. It prints the exact local tag and push
commands but does not run them.

## What It Proves

The preflight proves repository-local facts:

- release docs exist
- package version matches `0.1.0-alpha`
- migration freeze hashes match migration files
- dependency audit evidence matches the current lockfile hash
- required Week 20 through Week 26 workflow states are complete and include CI
  evidence
- compatibility matrix promotions are backed by linked live evidence
- CLI live-client login and sync evidence is recorded
- staging dry-run evidence includes command, bindings, bundle hash, and
  explicit non-deploy limitations
- Cloudflare D1/R2 resource evidence is recorded and D1 IDs are no longer
  placeholders
- the Linear seed is structurally ready to apply

## What It Does Not Prove

The preflight does not contact Cloudflare, GitHub, Linear, package registries, or
official clients. It does not tag a release and does not deploy.

The tag preflight also does not create or push a Git tag, verify remote tag
absence, or publish a GitHub release. Those actions remain explicit operator
steps after CI passes on the release commit.

The preflight still does not prove full browser, desktop, Android, iOS, TOTP, or
item-mutation behavior through real clients. Those remain compatibility limits
until separate evidence is recorded.

## Expected Current Result

After CLI live-client evidence is recorded, the expected repository-local result
is `ready` when all other evidence files remain current. The alpha tag still
requires GitHub Actions CI on the release commit and the repository brand scan
before publishing. `pnpm release:tag:preflight -- --strict` is expected to
report `ready` on the clean release commit immediately before the operator runs
the printed tag commands.
