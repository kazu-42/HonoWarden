# Dependency Audit Evidence

Last scanned: 2026-07-11.

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

## Lockfile Evidence

- lockfile: `pnpm-lock.yaml`
- SHA-256:
  `6ccdb94979a39b4e71afa6bf8ab556937dca35caf76812808a1b1a419537ba5b`

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
