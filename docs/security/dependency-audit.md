# Dependency Audit Evidence

Last scanned: 2026-07-23.

This is a point-in-time dependency audit snapshot for the repository state used
by the Week 24 security review materials. Re-run the command before every
release candidate and after dependency updates.

## Command

```sh
pnpm audit --audit-level low
```

## Result

```text
No known vulnerabilities found
```

## Sharp Advisory Remediation

The 2026-07-22 rescan initially reported high advisory
`GHSA-f88m-g3jw-g9cj` against `sharp 0.34.5`, inherited from both direct
Miniflare and Wrangler's Miniflare dependency. The latest published Miniflare
still pinned that vulnerable version at readback time, so a routine Wrangler
upgrade could not remove it.

HonoWarden requires Node.js 22.13 or newer and configures no Cloudflare Images
binding. The repository therefore uses a temporary `overrides` policy in
`pnpm-workspace.yaml` to pin `sharp 0.35.3`, then verifies package audit, the
complete test suite, and a real local Wrangler D1/R2 lifecycle. Remove the
override only after the published Miniflare dependency resolves to a patched
sharp version and the same gates pass without it. Do not treat the override as
approval to add an Images binding without a dedicated image-transform
compatibility test.

## Ajv Advisory Avoidance

The 2026-07-22 credential-evidence schema test initially selected Ajv 8.17.1.
The required low-severity audit gate rejected it because
`GHSA-2g4f-4pwh-qvx6` affects Ajv versions before 8.18.0 when the optional
`$data` feature is enabled. HonoWarden does not enable `$data`, but the test-only
dependency was upgraded to patched Ajv 8.20.0 instead of accepting a known
advisory. The audit result above is from the patched lockfile.

## Markdown Contract Parser

The 2026-07-23 HON-229 reconciliation added `unified`, `remark-parse`,
`remark-gfm`, and the compile-time-only `@types/mdast` package as development
dependencies. They parse user-facing documentation in tests so canonical
credential links, heading blocks, and tables are checked structurally instead
of with partial regular expressions. They are not imported by the Worker
runtime or production bundle. The audit result above and lockfile digest below
were regenerated after this dependency change.

## Lockfile Evidence

- lockfile: `pnpm-lock.yaml`
- SHA-256:
  `bf9f3c6065cb2265448a4ffb566a0cb7db3a572162c191dd3f01091cb18df4c5`

## Scope

This audit covers advisories available through the package manager registry at
scan time. It does not prove that dependencies are vulnerability-free, nor does
it cover Cloudflare platform vulnerabilities, browser client vulnerabilities, or
security issues in project code.

## Follow-Up Rules

- If a future scan reports a vulnerable production dependency, block release
  until patched, removed, or documented with a risk acceptance.
- If a future scan reports a vulnerable dev-only dependency, decide whether it
  can affect CI, generated artifacts, release packaging, or local operator
  scripts before accepting risk.
- Recompute the lockfile checksum after any dependency or lockfile change.
