Packet ID: 03-docs-workflow

Objective: Document the packet and record workflow evidence.

Context: Operators need a clear separation between GitHub Release publication
and post-release deploy/email readiness.

Files / sources:

- `docs/release/index.md`
- `docs/release/publication-gate.md`
- `docs/operations/website-email.md`
- `docs/current-state.md`
- `.workflow/week-26-post-alpha-ops-readiness-packet/*`

Do:

- Point release and website/email docs to `pnpm ops:readiness:packet`.
- Document that release completion is not deploy, DNS, website, or email proof.
- Record current-state implemented and not-implemented items.

Do not:

- Claim live Worker, website, Email Routing, or rollback evidence exists.

Expected output: docs explain the packet and preserve approval gates.

Verification: release docs tests, format, workflow verifier.
