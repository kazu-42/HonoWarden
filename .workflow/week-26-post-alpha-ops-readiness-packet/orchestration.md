# Orchestration: Week 26 Post Alpha Ops Readiness Packet

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit

# Week 26 Post Alpha Ops Readiness Packet Orchestration

Goal: add a read-only operations readiness packet that makes post-release deploy,
website, DNS, email, smoke, and rollback gates visible without changing external
systems.

Sequence:

1. Define the packet contract and package command.
2. Add focused tests using fake `git` and `gh` binaries for release readback.
3. Document the packet in release and website/email operations docs.
4. Run focused tests, typecheck, lint, format, brand scan, strict release gate,
   workflow verification, and release status readback.

Branching rules:

- If the packet reports `ready` while the release is still draft-ready, stop and
  fix the release requirement.
- If local email inputs make Email Routing pass without live evidence, stop and
  split local input readiness from live route evidence.
- If any command mutates GitHub Release state, tags, Cloudflare, DNS, email, or
  secrets, stop and revert that behavior before committing.

Packets:

- `01-contract`: script and package command.
- `02-tests`: focused packet and docs tests.
- `03-docs-workflow`: docs and workflow state.
- `04-verification`: local and read-only release checks.
