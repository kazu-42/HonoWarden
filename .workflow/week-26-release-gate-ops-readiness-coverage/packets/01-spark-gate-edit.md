Packet ID: 01-spark-gate-edit

Objective: Require the completed ops readiness packet workflow in release gate
workflow evidence.

Owner: Spark worker.

Files:

- `scripts/honowarden-release-gate.mjs`
- `test/ops/release-gate.test.ts`

Do:

- Add `week-26-post-alpha-ops-readiness-packet` to required workflow slugs.
- Assert `.workflow/week-26-post-alpha-ops-readiness-packet/state.json` in the
  release gate test.

Do not:

- Edit docs, workflow artifacts, release packets, tags, releases, Cloudflare,
  DNS, email, Linear, or secrets.

Verification: focused release gate test if practical.
