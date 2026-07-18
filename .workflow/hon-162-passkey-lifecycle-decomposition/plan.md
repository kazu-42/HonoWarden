# HON-162 passkey lifecycle decomposition

## Goal

Turn HON-162 from a broad passkey lifecycle slice into a reviewed, one-PR child
issue DAG grounded in HonoWarden's current auth/session/schema boundaries and the
pinned official client/server contract. Select the first unblocked child for
implementation without claiming runtime support early.

## Success Criteria

- Map enrollment, assertion, credential list/rename/delete, challenge, RP/origin,
  sign-counter, token, session-revocation, recovery, and client-compatibility
  behavior from reproducibly pinned public sources.
- Separate WebAuthn login credentials from any vault-encryption/passkey feature
  that requires client-side key material or a different protocol.
- Record the current HonoWarden gaps and reusable auth/session/retention/audit
  primitives.
- Decompose HON-162 into bounded one-PR children with acceptance criteria,
  migration ownership, default-off activation, evidence requirements, and an
  acyclic directed `blocks` graph.
- Synchronize parent/children/relations to Linear and independently read back
  title, description marker, project, parent, state, priority, archive, and edge
  invariants.
- Choose the first dependency-free child and create an implementation handoff.

## Current Context

- Live Linear inventory at `2026-07-18T18:26:18.235Z`: 207 total, 109 archived,
  93 active unarchived, and 5 completed unarchived.
- HON-162 is Backlog, priority 0, non-archived, under HON-158 and
  `HonoWarden Post-Alpha Roadmap`, with no active blocking relation.
- Main is `30c361fd4c7bcdd01fab47be77037adec31226a5`. There is no current
  WebAuthn/passkey repository, migration, route, or compatibility row.
- Existing TOTP challenges, refresh-token rotation, device records, security
  stamps, audit persistence, request quotas, retention cleanup, and explicit
  unsupported/config behavior may be reused only after contract review.
- Official source baseline remains client `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1` and server `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.

## Constraints

- Preserve official wire compatibility but implement an original HonoWarden
  design; do not copy proprietary UI, product copy, or non-public behavior.
- Do not enroll a real authenticator, write credentials, deploy, change DNS or
  bindings, enable production, or use real account/token/key material in this
  planning workflow.
- Challenges must be account/purpose/origin/RP/device bound, expiring, single
  use, hashed or otherwise non-replayable at rest, and fail closed.
- Custom-domain, staging, localhost, native-client, and reverse-proxy origin/RP
  policy must be explicit rather than inferred from untrusted headers.
- Do not let credential deletion or security-stamp/session rotation remove the
  last recovery path without an intentional policy and current proof.
- Source capability, environment activation, live authenticator evidence, and
  compatibility promotion remain separate claims.

## Risks

- Conflating WebAuthn login with passkey-based vault key recovery can make a
  server credential appear sufficient to decrypt client data when it is not.
- Trusting forwarded origin/host data can bind a challenge to an attacker-chosen
  RP ID or accept assertions for the wrong custom domain.
- Read-then-consume challenges or non-atomic sign-counter writes permit replay or
  counter rollback races.
- Strict sign-counter rejection can lock out valid multi-device/synced passkeys;
  ignoring counters loses cloned-authenticator detection.
- Credential IDs, user handles, attestation metadata, transports, backup flags,
  and authenticator names can leak account/device identity through logs or APIs.
- Deleting the last phishing-resistant or fallback method can create irreversible
  account lockout.

## Approval Required

- Granted: local read/write research artifacts, tests, isolated worktrees, and
  normal Linear issue/comment/relation/state writes with exact readback.
- Separate explicit approval: GitHub commit/push/PR/comment/merge, deploy,
  production data or routing, bindings, secrets, user/credential mutation,
  browser/hardware authenticator enrollment, destructive actions, paid services,
  and external contact.

## Work Packets

- `01-current-auth-boundary`: map current source, schema, sessions, challenge,
  device, audit, retention, config, and unsupported boundaries.
- `02-pinned-client-contract`: map pinned client enrollment/login/management
  requests, response fields, native/browser behavior, and feature discovery.
- `03-pinned-server-security-contract`: map pinned server routes, entities,
  challenge/origin/RP/counter semantics, state transitions, and failure behavior.
- `04-linear-decomposition`: integrate findings into one-PR children and an exact
  Linear parent/relation/readback checkpoint.

## Integration Policy

- Prefer the pinned client wire shape when client/server implementation details
  differ; document a translation rather than guessing.
- Reject any child boundary that exposes partial login support before challenge,
  credential, recovery, audit, quota, and rollback invariants are available.
- Put each migration and state transition under exactly one child owner. Shared
  activation and live-client evidence belong in a final integration child.
- Resolve contract conflicts against pinned source and current HonoWarden code;
  do not average reviewer opinions.

## Verification

- Source pins and relevant paths read back from local immutable clones.
- Current gap inventory is backed by `rg`, route/config/schema tests, and source
  references.
- Decomposition test validates identifiers/markers/edge acyclicity before write.
- Linear apply plus separate direct readback validates every managed invariant.
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py`.
- `pnpm format` and `git diff --check` for tracked candidate artifacts.

## Reusable Artifacts

The route/state/threat inventory becomes the acceptance contract for every
HON-162 child and a template for later delegated-recovery credential features.
