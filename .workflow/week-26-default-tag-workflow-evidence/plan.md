# Week 26 default tag workflow evidence

## Goal

Make the alpha release status, publication, completion-audit, and operations
readiness packets resolve the already-recorded `Release Tag Verification`
evidence by default, while preserving explicit CLI evidence overrides and a
strict missing-evidence test path.

## Success Criteria

- `release:publish:packet`, `release:published:packet`,
  `release:status:packet`, `release:completion:audit`, and
  `ops:readiness:packet` fill missing tag workflow run id/url from
  `.workflow/week-26-release-tag-recovery/state.json`.
- Explicit `--tag-workflow-run-id` and `--tag-workflow-url` values remain
  authoritative.
- The resolved run is still verified through `gh run view`; committed workflow
  state is not trusted without live readback.
- `--no-default-tag-workflow-evidence` preserves strict missing-evidence tests.
- No release publication, tag mutation, deploy, DNS/Email Routing write, email
  send, or secret write occurs.

## Current Context

`release:status:packet` and `ops:readiness:packet` previously required the
operator to repeat `--tag-workflow-run-id 28863312935 --tag-workflow-url
https://github.com/kazu-42/HonoWarden/actions/runs/28863312935` for accurate
draft-ready readback. The tag verification evidence is already committed under
`.workflow/week-26-release-tag-recovery/state.json`, so safe default resolution
can reduce operational false negatives.

## Constraints

- Preserve explicit CLI overrides.
- Do not infer publication approval from default evidence.
- Do not perform any external write.
- Keep repository brand scan clean.

## Risks

- Blindly trusting committed workflow state would allow stale evidence to pass.
- Overwriting explicit CLI args would make corrective verification harder.
- Removing the missing-evidence failure path would weaken strict-mode tests.

## Approval Required

No approval required for local code, tests, docs, workflow artifacts, PR, and CI.
Release publication, tag mutation, Cloudflare deploy/DNS/Email Routing writes,
email sends, and secret writes remain separately approval-gated.

## Work Packets

- `01-helper`: implement default evidence resolver.
- `02-integration`: wire resolver into release/ops packets and tests.
- `03-docs-workflow`: document operator behavior and workflow state.
- `04-verification`: run local checks, review, PR CI, and main CI readback.

## Integration Policy

Accept only changes that improve read-only release evidence readback. Reject any
change that publishes, deploys, mutates tags, changes DNS/email routing, sends
email, or writes secrets.

## Verification

- Focused release/ops packet tests.
- `pnpm check`, `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm compat:test`.
- `pnpm release:gate -- --strict`.
- `pnpm brand:scan`.
- `pnpm release:status:packet`, `pnpm release:completion:audit`,
  `pnpm ops:readiness:packet`, and `pnpm release:publish:packet -- --strict`
  without tag workflow arguments.
- `codex review --uncommitted`.
- PR CI and post-merge main CI readback.

## Reusable Artifacts

`scripts/honowarden-tag-workflow-evidence.mjs` can be reused by future read-only
release packets that need default tag workflow evidence while preserving explicit
operator-provided evidence.
