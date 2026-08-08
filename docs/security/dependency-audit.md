# Dependency Audit Evidence

Last scanned: 2026-08-08.

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

## Brace Expansion Advisory Remediation

The 2026-07-28 rescan reported high advisory
`GHSA-mh99-v99m-4gvg` against `brace-expansion 5.0.7`. The only dependency
path was development tooling: ESLint and typescript-eslint resolved
`minimatch 10.2.5`, which pinned the vulnerable version exactly. The repository
temporarily overrode that exact edge to `brace-expansion 5.0.8`, whose
`maxLength` bound prevented unbounded output allocation.

The 2026-08-05 rescan reported follow-up high advisory
`GHSA-rgw5-rvv9-x895` against versions before `5.0.9`. The exact transitive
edge now resolves to `brace-expansion 5.0.9`. Remove the override after all
upstream minimatch paths select the patched line. Re-run the low audit, lint,
full tests, and release gate before removal. This override does not make
attacker-controlled glob patterns an approved runtime input.

## 2026-08-07 Advisory Remediation

The fresh release-candidate audit found nine current advisories: three high and
six moderate:

- `GHSA-4cwx-7wf7-3272`, `GHSA-8xcm-r25x-g524`,
  `GHSA-m8rv-5g2x-5cg5`, `GHSA-jr45-8vmc-qm54`, and
  `GHSA-v3r7-h72x-cjcm` for `undici`;
- `GHSA-7p8r-x3mc-p8w7` for `fast-uri`;
- `GHSA-rgw5-rvv9-x895` for `brace-expansion`;
- `GHSA-fxqj-rqcc-2cmp` for `postcss`; and
- `GHSA-8j4g-w8fx-2239` for Hono.

The production Worker dependency moved from Hono `4.12.30` to the patched
same-minor release `4.12.34`.

The remaining paths are development and release tooling. Exact transitive
overrides move Miniflare's `undici` to `7.29.0`, Ajv's `fast-uri` to `3.1.5`,
Vite's `postcss` to `8.5.23`, and minimatch's `brace-expansion` to `5.0.9`.
These are the first patched releases for the reported ranges. They do not
expand runtime features or authorize untrusted tooling inputs. Remove each
override only after its direct parent selects a patched version and the audit,
typecheck, lint, full test suite, local Worker coverage, and release gate pass
without it.

## 2026-08-08 Nanoid Advisory Remediation

The next-day rescan reported high advisory `GHSA-2v37-7h3g-55p8` against
`nanoid 3.3.16`, reached only through Vitest's Vite/PostCSS development-tooling
path. An exact transitive override moves PostCSS's `nanoid` to `3.3.17`, the
first patched release in that line. Remove the override after the direct parent
selects a patched version and the same audit, static, test, local Worker, and
release gates pass without it. This override does not authorize custom Nanoid
generators with attacker-controlled sizes.

## Lockfile Evidence

- lockfile: `pnpm-lock.yaml`
- SHA-256:
  `7ad9c3ce791152759a897dc0f7aa7a5bc2e2e7dcf99d30ebd8b702c1ed2c4814`

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
