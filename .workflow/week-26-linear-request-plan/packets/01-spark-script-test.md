# Packet 01: Spark script/test

## Objective

Implement a local-only `linear:request-plan` CLI and targeted tests.

## Ownership

Spark may edit only:

- `scripts/honowarden-linear-request-plan.mjs`
- `test/ops/linear-request-plan.test.ts`

Spark is not alone in the codebase. Do not revert edits made by others, and
adjust to existing local patterns.

## Required Behavior

- CLI: `node scripts/honowarden-linear-request-plan.mjs --mutation-packet <path>`
- Accept standalone `--`.
- Support `--strict`.
- Emit JSON to stdout.
- On `--strict` and non-ready report, exit non-zero and write a concise stderr
  message.
- Read only the supplied JSON file.
- Do not read credentials, call `fetch`, use GraphQL, or mutate external
  systems.
- Require input `schemaVersion: 1`, `status: "ready"`, and a `mutationSteps`
  array.
- Block unsupported mutation step kinds instead of omitting them.
- Ready output should include:
  - `schemaVersion: 1`
  - `generatedAt`
  - `mode: "request_plan"`
  - `status`
  - `blockingReason`
  - `summary`
  - `requestSteps`
  - `confirmations`
  - `manualConfirmations`
  - `unsupportedMutationSteps`
  - `limitations`
- Request entries should use local intent names, not live GraphQL mutation names.
  Suggested intents:
  - `ensure_label`
  - `ensure_initiative`
  - `ensure_project`
  - `ensure_milestone`
  - `ensure_issue`
  - `ensure_document`
  - `ensure_view`
  - `ensure_pulse_setting`
  - `ensure_project_update`
- Each request entry should preserve `id`, `seedKey`, `kind`, `name`, `title`,
  `action`, `dependencies`, and `fields`, plus a `requires` array describing
  IDs the later writer must resolve.

## Verification

Run:

```sh
pnpm exec vitest run test/ops/linear-request-plan.test.ts
```

Report changed files and test result.
