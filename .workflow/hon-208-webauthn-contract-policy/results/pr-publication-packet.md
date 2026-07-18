# HON-208 GitHub publication packet

## Gate status

This candidate is locally source-ready but not published. No commit, push, pull
request, merge, deployment, runtime activation, or Linear completion is
authorized by this packet. Commit, push, and draft pull-request creation require
explicit operator approval. Merge remains a separate approval after CI, review
threads, and main-branch readback.

## Proposed publication

- Base: `main` at `30c361fd4c7bcdd01fab47be77037adec31226a5`
- Head: `feat/hon-208-webauthn-contract-policy`
- Linear issue: `HON-208`, child of `HON-162`
- Commit message: `feat: define WebAuthn trust contract and policy`
- Draft pull-request title: `feat: define WebAuthn trust contract and policy`
- Final local diff: `48 files changed, 5268 insertions(+), 1 deletion(-)`
- Staging state: intent-to-add entries expose new files to review; no content is
  staged for commit.

The workflow evidence accounts for most of the file count. Runtime behavior is
limited to an unreferenced pure policy resolver and optional binding types;
tracked environments remain explicitly disabled.

## Pre-publication review evidence

`codex review -c model_reasoning_effort=xhigh --base main` completed with exit
code 0 on 2026-07-19 JST. Its final conclusion was that it found no introduced
correctness, security, or maintainability issues in the WebAuthn policy parser,
configuration defaults, tests, documentation, or workflow artifacts. The
review independently passed the focused 62-test suite, TypeScript check, lint,
formatting, and diff check.

The review sandbox could not use its local TCP fixture in three pre-existing
backup CLI tests, so both full-suite attempts inside that network-restricted
review process timed out at those tests. The reviewer identified the sandbox
network restriction as the cause. This is not accepted as full-suite evidence;
the normal local `pnpm test` result below is the publication gate.

An earlier independent security/compatibility review found WHATWG URL repair
and Unicode case-folding bypasses. Each finding was reproduced by a failing
test, fixed with narrow raw-serialization and visible-ASCII guards, and then
closed by a no-findings re-review.

## Verification

- [x] Focused WebAuthn/config/docs suite: 4 files, 62 tests
- [x] WebAuthn policy subset: 39 tests
- [x] Full `pnpm test`: 80 files, 817 tests
- [x] `pnpm check`
- [x] `pnpm lint`
- [x] `pnpm format`
- [x] `pnpm brand:scan`
- [x] `git diff --check`
- [x] HON-162 Node plan tests: 4 tests
- [x] HON-162 and HON-208 workflow verification
- [x] Wrangler dry-run for top-level, staging, and production; WebAuthn false in
      each environment
- [x] Added-line secret scan
- [x] Independent security/compatibility review and no-findings re-review
- [x] `codex review --base main` no-findings result
- [x] Linear source-ready checkpoint and separate exact readback

The full local gate was rerun after this packet was formatted. Any source change
after approval invalidates the review evidence and requires the relevant focused
and full checks again before publication.

## Draft pull-request body

```markdown
## Summary

- define the pinned WebAuthn/passkey protocol, recovery boundaries, and threat model for HON-208
- add a pure, default-off RP ID/origin policy with deterministic fail-closed errors and no partial allowlist
- add optional environment bindings, operator guidance, and regression coverage for URL/Unicode normalization bypasses
- preserve the child boundary: no verifier dependency, migration, route, session change, runtime activation, or compatibility claim

Linear: HON-208 (child of HON-162)

## Verification

- [x] `pnpm check`
- [x] `pnpm lint`
- [x] `pnpm test` (80 files, 817 tests)
- [x] `pnpm format`
- [x] `pnpm brand:scan`
- [x] `git diff --check`
- [x] focused WebAuthn/config/docs suite (4 files, 62 tests)
- [x] Wrangler dry-run for top-level, staging, and production
- [x] independent security/compatibility review and `codex review --base main`

## Compatibility Notes

This is a source contract and trust-policy foundation, not an advertised or deployed WebAuthn capability. `HONOWARDEN_WEBAUTHN_ENABLED` remains `false` in every tracked environment, and no route, migration, verifier dependency, or client behavior changes. HON-209 through HON-214 own storage/verifier state, ceremonies, lifecycle operations, activation, and real-authenticator evidence.

The parser intentionally accepts only exact canonical origins. It rejects wildcard, credential-bearing, path/query/fragment, encoded or Unicode-repaired, IP-hosted, cross-RP, and non-canonical inputs. HTTP is limited to exact localhost with a separate explicit opt-in.

## Security Notes

RP ID and accepted origins are environment-owned trust roots and are never derived from request headers. Enabled but invalid configuration fails closed with stable non-secret error codes and no partial allowlist or raw-value disclosure. The tracked feature flag remains off, so rollback before activation is a source revert with no data migration or runtime cleanup. See ADR 0012 and `docs/security/webauthn-threat-model.md`.
```

## Publication sequence after approval

1. Recheck the exact unstaged diff and secret scan.
2. Stage only the HON-162/HON-208 candidate and inspect the cached diff.
3. Commit with the proposed message.
4. Push `feat/hon-208-webauthn-contract-policy` to `origin`.
5. Create the proposed pull request as a draft against `main`.
6. Read back the pull request head/base, changed files, body, and checks.
7. Resolve review findings and rerun invalidated gates.
8. Request separate merge approval only after CI and review threads are clean.
9. After merge, verify main ancestry and source state, update HON-208 with exact
   merge evidence, move it to Done, and unblock HON-209.

## Rollback and failure handling

- Before publication, remove only this worktree/branch after proving no unique
  changes remain; do not remove any dirty sibling worktree.
- After push but before merge, keep the draft pull request open while repairing
  the branch. Closing or deleting remote state is a separate GitHub mutation.
- After merge and before later activation, revert the source commit. There is no
  WebAuthn migration or stored credential state in HON-208 to unwind.
- Do not enable the flag as a workaround. Invalid enabled policy must continue
  to fail closed, and activation remains owned by HON-213.
- A failing CI check, unresolved review thread, base drift, secret-scan finding,
  or changed source invalidates merge readiness and leaves HON-208 In Progress.
