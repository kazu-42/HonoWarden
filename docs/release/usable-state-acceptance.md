# Usable-State Acceptance Manifest

Status: verifier ready; no HON-110 common-target run has passed.

This runbook defines the machine-checkable contract for the final synthetic
usable-state run in HON-110. It binds SU-01 through SU-10 to one source commit,
one Worker version, one official browser-extension/Desktop client set, and one
post-run cleanup readback.

The verifier is deliberately read-only. It does not run official clients, does
not deploy, does not call Cloudflare, and does not mutate D1, R2, the inquiry
inbox, or Linear. A `passed` verifier report validates the manifest and
redacted evidence structure; it does not prove that HON-110 has passed. The
operator still owns the live staging observations, cleanup, committed evidence,
PR/CI, and runtime readback.

## Command

Run the verifier from the repository revision that contains the acceptance
evidence:

```sh
pnpm usable:acceptance:verify -- \
  --strict \
  --manifest docs/release/usable-state-acceptance-runs/<run-id>/manifest.json
```

Without `--strict`, the command always emits a JSON report so an agent can
inspect blockers. Strict mode exits non-zero unless the report status is
`passed`.

The possible report states are:

- `not_ready`: the manifest, target, client pins, evidence paths, binding
  markers, or safety checks are incomplete or invalid;
- `failed`: the evidence is structurally valid but at least one criterion is
  red or cleanup did not reach zero;
- `passed`: all ten criteria are explicitly green and every required cleanup
  count is zero.

There is no skip, waiver, warning-only, average, or partial-pass state. Keep an
observed failure red and open a focused defect.

## Run Directory

Every run uses one timestamp-derived ID and a dedicated directory:

```text
docs/release/usable-state-acceptance-runs/20260716T010000Z/
  manifest.json
  target-readback.md
  cleanup-readback.md
  criteria/
    SU-01.md
    SU-02.md
    ...
    SU-10.md
```

The run ID must equal the UTC `startedAt` timestamp with punctuation removed.
The manifest must be named `manifest.json` directly below that run directory.
Absolute paths, traversal, backslash aliases, symlinks, missing files, and
files larger than 256 KiB fail closed. The verifier also rejects every file or
directory that is not declared by the manifest structure above; keep debug
logs, screenshots, and other operator artifacts outside this directory.

## Manifest Contract

The schema is intentionally closed: unknown fields fail instead of becoming an
unreviewed place to retain credentials or private data.

```json
{
  "schemaVersion": 1,
  "runId": "20260716T010000Z",
  "startedAt": "2026-07-16T01:00:00Z",
  "completedAt": "2026-07-16T01:30:00Z",
  "environment": "staging",
  "sourceCommit": "<full-40-character-commit>",
  "worker": {
    "name": "honowarden-staging",
    "versionId": "<worker-version-uuid>",
    "serverUrl": "https://honowarden-staging.ghive42.workers.dev"
  },
  "clients": {
    "browser_extension": {
      "version": "<compat-matrix-version>",
      "build": null,
      "releaseTag": "<compat-matrix-release-tag>"
    },
    "desktop": {
      "version": "<compat-matrix-version>",
      "build": null,
      "releaseTag": "<compat-matrix-release-tag>"
    }
  },
  "targetEvidence": ["target-readback.md"],
  "criteria": [
    { "id": "SU-01", "status": "pass", "evidence": ["criteria/SU-01.md"] },
    { "id": "SU-02", "status": "pass", "evidence": ["criteria/SU-02.md"] },
    { "id": "SU-03", "status": "pass", "evidence": ["criteria/SU-03.md"] },
    { "id": "SU-04", "status": "pass", "evidence": ["criteria/SU-04.md"] },
    { "id": "SU-05", "status": "pass", "evidence": ["criteria/SU-05.md"] },
    { "id": "SU-06", "status": "pass", "evidence": ["criteria/SU-06.md"] },
    { "id": "SU-07", "status": "pass", "evidence": ["criteria/SU-07.md"] },
    { "id": "SU-08", "status": "pass", "evidence": ["criteria/SU-08.md"] },
    { "id": "SU-09", "status": "pass", "evidence": ["criteria/SU-09.md"] },
    { "id": "SU-10", "status": "pass", "evidence": ["criteria/SU-10.md"] }
  ],
  "cleanup": {
    "status": "pass",
    "checkedAt": "2026-07-16T01:31:00Z",
    "counts": {
      "users": 0,
      "devices": 0,
      "refreshTokens": 0,
      "authRequests": 0,
      "orphanDevices": 0,
      "r2SyntheticObjects": 0,
      "pendingInquiryApprovals": 0,
      "pendingOutboundDispatches": 0,
      "foreignKeyViolations": 0
    },
    "evidence": ["cleanup-readback.md"]
  }
}
```

The full source commit must exist in the local Git object database. Browser and
Desktop version, build, and release tag must exactly match
`compat/client-matrix.json`. The Worker URL must be credential-free HTTPS with
no alternate port, query, fragment, or path and must exactly match
`https://honowarden-staging.ghive42.workers.dev`.

The source commit identifies the deployed server under test. The later commit
that adds redacted run evidence is a separate artifact revision and must be
recorded in HON-110 and the PR. Do not replace the deployed source commit with
the evidence-only commit.

## Evidence Binding

Every referenced Markdown file must use these as its first four non-empty lines
after an optional H1. A code example, historical section, or copied template is
not a canonical binding header:

```text
Status: passed
Run ID: `<run-id>`
Source commit: `<full-source-commit>`
Worker version ID: `<worker-version-uuid>`
```

A failed criterion uses `Status: failed`; its manifest row uses
`"status": "fail"`. The verifier returns `failed`, preserving that result.
Changing the manifest to pass while the evidence says failed, or binding any
file to another run, commit, or Worker version, returns `not_ready`.

The target readback must place these four lines immediately after the binding
header:

```text
Environment: staging
Worker name: honowarden-staging
Health status: passed
Migration status: current
```

The cleanup readback places every cleanup key and observed integer immediately
after the binding header, in manifest order. For example, `users: ` is followed
by the Markdown code value `0`. The manifest and readback must agree, and each
marker may occur only once. All counts, including foreign-key violations, must
be zero for a passing report.

## Criterion Ownership

Use the criteria from `docs/implementation-plan.md` without broadening them:

- SU-01: clean official browser extension and Desktop login/sync;
- SU-02: item lifecycle plus logout/login persistence;
- SU-03: login-with-device request, approval, and one-time consumption;
- SU-04: notification failure converges through polling;
- SU-05: refresh rotation and replay rejection in the client lifecycle;
- SU-06: inbound inquiry routing and metadata-only handling;
- SU-07: one human-approved, duplicate-safe outbound reply;
- SU-08: backup, restore, rollback, health, foreign-key, and cleanup checks;
- SU-09: website and security-contact reachability;
- SU-10: committed evidence contains no real account, credential, private
  message, vault payload, or encrypted material.

Per-client `pnpm live:regression:packet` reports can support SU-01 through SU-05,
but they do not satisfy the aggregate matrix by themselves.

## Evidence Safety

Keep the run synthetic and summarize behavior structurally. The verifier rejects
common bearer credentials, JWTs, private-key headers, sensitive JSON fields,
raw body fields, opaque vault strings, and non-test/non-public email addresses.
RFC example domains (`example.com`, `example.net`, and `example.org`) and
special-use `.example`, `.invalid`, `.localhost`, and `.test` suffixes are
accepted for synthetic identities. The only public-domain addresses accepted
are the documented `security`, `support`, `hello`, `admin`, `postmaster`, and
`abuse` aliases at `honowarden.com`; other project-domain mailboxes fail closed.
The verifier reports only a rule ID and safe relative path, never the matched
value.

Automated scanning is defense in depth, not proof that arbitrary prose is safe.
Before committing, inspect every file and run the repository brand, policy,
release, and independent-review gates. Screenshots are not accepted in the
dedicated run directory; review them separately and keep them out of commits.

## Execution Order

1. Select one reviewed source commit and deploy only that commit to staging.
2. Record Worker version, health, migration state, and credential-free URL.
3. Pin clean official browser-extension and Desktop versions from the matrix.
4. Run every SU criterion; record failures immediately without waivers.
5. Delete synthetic vault fixtures, R2 objects, pending inquiry work, and
   pending dispatches; run foreign-key and queue readbacks.
6. Run the verifier in strict mode and keep its JSON report with the run.
7. Commit only reviewed redacted evidence and run full CI plus independent
   review.
8. Update HON-110 with source commit, evidence commit, PR, CI, Worker version,
   cleanup readback, and remaining risks.

HON-110 closes only after this live sequence and its evidence are complete. A
locally generated passing fixture, a passing packet shape, or a green unit test
is not runtime acceptance.

## Rollback

The verifier itself is additive and has no runtime rollback. Revert the script,
package command, runbook, and tests if the contract is incorrect. For the live
run, use the rollback steps named in the pinned staging evidence, restore the
previous Worker version if needed, and still complete synthetic cleanup. Never
delete or rewrite failed evidence merely to produce a green report.
