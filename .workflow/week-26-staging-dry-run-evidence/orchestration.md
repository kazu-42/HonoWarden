# Orchestration: Week 26 Staging Dry Run Evidence

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If `wrangler deploy --dry-run` requires authentication or remote access, stop
  at repository-only validation and keep staging evidence blocked.
- If dry-run succeeds but bundle output is picked up by lint/format, extend tool
  ignores for generated artifacts rather than weakening lint rules.
- If evidence would imply real Cloudflare resources exist, rewrite it as
  dry-run evidence and keep Cloudflare resource evidence blocked.

## Packet Prompts

### 01-dry-run-script

Implement a local staging dry-run command that bundles the staging Worker, checks
expected bindings, records bundle metadata, and emits JSON evidence.

### 02-gate-docs

Require staging evidence fields in the release gate and update operator docs so
the evidence is explicit about dry-run limitations.

### 03-verification

Run targeted and broad checks, brand scans, workflow verification, push, watch
CI, and update the workflow state with the final evidence.

## Completion Audit

Completion for this slice means the staging evidence blocker is resolved by
durable dry-run evidence. It does not mean live client evidence or Cloudflare
resource evidence is complete.
