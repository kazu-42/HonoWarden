Packet ID: 04-verification

Objective: Verify the packet locally and keep alpha release state unchanged.

Context: The current release remains a draft prerelease requiring explicit
publication approval. Verification must include packet execution and read-only
release status.

Files / sources:

- local test and lint outputs
- `pnpm ops:readiness:packet`
- `pnpm release:status:packet`
- `pnpm release:completion:audit`

Do:

- Run focused tests, broad tests, typecheck, lint, format, brand scan, compat
  tests, strict release gate, workflow verifier, and read-only release packets.
- Confirm the ops packet reports `not_ready` with
  `release_publication_approval_required`.

Do not:

- Publish the release, deploy, mutate DNS/email, or write secrets.

Expected output: all local checks pass and release remains draft-ready.

Verification: command list recorded in `state.json` and `final-report.md`.
