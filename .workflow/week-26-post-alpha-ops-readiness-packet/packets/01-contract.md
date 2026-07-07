Packet ID: 01-contract

Objective: Add the read-only operations readiness packet command.

Context: Alpha release completion is already modeled by
`release:completion:audit`. Post-release operations need a separate gate so
deploy, website, DNS, email, smoke, and rollback work does not get implied by a
published GitHub Release.

Files / sources:

- `scripts/honowarden-ops-readiness-packet.mjs`
- `package.json`
- `scripts/honowarden-alpha-completion-audit.mjs`
- `scripts/honowarden-email-preflight.mjs`

Do:

- Aggregate release completion audit and email preflight as read-only inputs.
- Treat Cloudflare/staging docs as recorded evidence only when they contain
  `Status: passed`.
- Keep live Worker, website, email routing, and rollback evidence as separate
  requirements.
- Add `pnpm ops:readiness:packet`.

Do not:

- Publish a release, move tags, deploy Workers, change DNS, configure Email
  Routing, send email, or print secrets.

Expected output: JSON packet with `status`, `blockingReason`, `requirements`,
`nextActions`, commands, evidence paths, and limitations.

Verification: focused packet tests, local packet execution, typecheck, lint,
format, brand scan.
