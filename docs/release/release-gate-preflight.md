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

## What It Proves

The preflight proves repository-local facts:

- release docs exist
- migration freeze hashes match migration files
- dependency audit evidence matches the current lockfile hash
- required Week 20 through Week 26 workflow states are complete and include CI
  evidence
- the compatibility matrix has not been promoted beyond fixture-only evidence
- the Linear seed is structurally ready to apply

## What It Does Not Prove

The preflight does not contact Cloudflare, GitHub, Linear, package registries, or
official clients. It does not tag a release and does not deploy.

These remain release blockers until recorded as separate evidence:

- synthetic live-client login and sync evidence
- staging fresh deploy smoke evidence
- Cloudflare D1, R2, Worker, route, and rollback evidence

## Expected Current Result

At feature-freeze time the expected result is `not_ready`. That is intentional:
the repository has the release process and local checks, but the alpha tag still
requires live operational evidence.
