# Orchestration: Week 5 Bootstrap Account

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

- If a local verification check fails, fix the smallest root cause and rerun the failed check before broad checks.
- If repository brand scan finds a hit, remove or split the literal before committing.
- If bootstrap needs real secrets or real Cloudflare resources, stop and ask before proceeding.
- If a packet reveals a security issue in the bootstrap surface, fix it before pushing.

## Packet Prompts

### 01-skill-install

Confirm project-local skill installation, wrapper command, and workflow scaffolding. Do not modify product code.

### 02-bootstrap-implementation

Implement private bootstrap account creation with default-off enablement, token authorization, email allowlist, D1 insert, route tests, repository tests, docs, and generated Cloudflare types. Do not enable public registration.

### 03-security-review

Review bootstrap for default-deny behavior, empty-token bypass, plaintext password storage, duplicate account behavior, and secret leakage. Produce accepted/rejected findings only.

### 04-verification

Run the full verification checklist, local HTTP smoke tests, workflow verification, commit, push, and CI watch.

## Completion Audit

- All packet result files exist under `results/`.
- Full checks pass.
- Local smoke tests pass.
- CI passes.
- `final-report.md` summarizes accepted results and remaining risks.
