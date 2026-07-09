# Packet 01: Spark script/test

## Objective

Implement a local-only `linear:resolution-plan` CLI and targeted tests.

## Ownership

Spark may edit only:

- `scripts/honowarden-linear-resolution-plan.mjs`
- `test/ops/linear-resolution-plan.test.ts`

Spark is not alone in the codebase. Do not revert edits made by others, and
adapt to existing local patterns.

## Required Behavior

- CLI: `node scripts/honowarden-linear-resolution-plan.mjs --request-plan <path>`
- Accept standalone `--`.
- Support optional `--resolution-map <path>`.
- Support `--strict`.
- Emit JSON to stdout.
- If `--strict` and report status is not `ready`, exit non-zero with concise
  stderr.
- Read only supplied JSON files.
- Do not read credentials, call `fetch`, use GraphQL, or mutate external
  systems.
- Require request plan `schemaVersion: 1`, `mode: "request_plan"`,
  `status: "ready"`, and `requestSteps` array.
- Without a resolution map, return `blocked` with `resolution_map_missing`.
- Resolution map suggested shape:

  ```json
  {
    "schemaVersion": 1,
    "workspaceId": "workspace-id",
    "teamId": "team-id",
    "refs": {
      "linear:project:alpha-api": "project-id",
      "linear:project-name:HonoWarden v0.1.0-alpha": "project-id",
      "linear:label:area:api": "label-id",
      "linear:milestone:alpha-api:Week 26 - v0.1.0-alpha": "milestone-id",
      "linear:issue:alpha-release": "issue-id",
      "linear:initiative:HonoWarden Alpha Launch": "initiative-id"
    },
    "stateIds": {
      "backlog": "state-backlog",
      "started": "state-started",
      "completed": "state-completed"
    }
  }
  ```

- Resolve each request step according to its `requires` values:
  - `workspaceId`
  - `teamId`
  - `initiativeId`
  - `projectId`
  - `milestoneId`
  - `stateId`
  - `stateIds`
  - `labelIds`
  - `blockedByIssueIds`
- Use request step dependencies and fields to locate refs/state names.
- Do not guess IDs. Missing entries must be reported in `missingResolutions`.
- Ready output should include `schemaVersion`, `generatedAt`,
  `mode: "resolution_plan"`, `status`, `blockingReason`, `summary`,
  `resolvedRequestSteps`, `confirmations`, `manualConfirmations`,
  `missingResolutions`, and `limitations`.

## Verification

Run:

```sh
pnpm exec vitest run test/ops/linear-resolution-plan.test.ts
```

Report changed files and test result.
