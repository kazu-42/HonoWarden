# Final Report: HON-162 passkey lifecycle decomposition

## Outcome

HON-162 is now an exact seven-child implementation DAG in Linear. The first
source child is HON-208. The plan keeps protocol and trust design ahead of
persistence, lets enrollment and assertion proceed in parallel after one schema
owner, and places runtime activation and real-authenticator evidence after all
source transitions.

## Accepted Results

- Current HonoWarden auth/session/schema boundary inventory with file and
  migration evidence.
- Pinned official clients `web-v2026.6.1` contract for anonymous assertion,
  `grant_type=webauthn`, credential management, and client-only PRF Vault-key
  recovery.
- Pinned official server `v2026.6.1` routes, credential state, ceremony rules,
  protected-token scopes, and translation risks.
- Current `@simplewebauthn/server` 13.3.2 official runtime support as the
  maintained verifier candidate; exact dependency and Workers dry-run remain
  owned by HON-209.
- Seven one-PR children with one migration owner, explicit safety/rollback and
  evidence requirements, and a cycle-free seven-edge relation graph.
- Guarded apply plus canonical and independent exact Linear readback.

## Rejected Results

- The two delegated broad source explorers were stopped after exceeding their
  bounded response window and returned no findings. Their work was not treated
  as evidence. The main path instead inspected only the required files at the
  immutable source commits.
- A single "WebAuthn login" implementation was rejected because signature
  authentication alone does not give the pinned client a Vault decryption key.
- Request-derived RP/origin policy, stateless replay-only tokens, read-then-set
  challenge consumption, fabricated sign-counter increments, and early
  compatibility promotion were rejected.

## Conflicts Resolved

- The pinned client has no rename route, while HON-162 requires rename. Rename is
  isolated as an authenticated HonoWarden extension in HON-212 and will not be
  presented as pinned-client compatibility.
- The pinned server's assertion replay cache uses a non-atomic read/set pattern.
  HON-209 requires an atomic D1 single-winner transition instead.
- Official source does not persist transports or backup flags. HON-209 adds them
  because the pinned client consumes transports and synced-passkey counter
  policy depends on backup state.
- Existing HonoWarden recent-proof logic accepts only a fresh password-issued
  access token, while the pinned credential routes send a secret-verification
  body. HON-210 and HON-212 must implement the exact supported proof contract
  without silently broadening the old helper.

## Verification Evidence

- `node --test scripts/hon-162-linear-plan.test.mjs`: 4/4 passed.
- `hon-162-linear-sync.mjs --validate`: 7 children and 7 relations, valid.
- Canonical apply: 7/7 children, 7/7 relations, 0 unexpected relations.
- Independent readback: exact parent, 7/7 children, 7/7 relation identities,
  no unexpected child or relation, and stable 214-item inventory.
- `git diff --check`: passed after artifact formatting.

## Remaining Risks

- No source implementation exists yet; HON-208 is the only unblocked child.
- A real verifier dependency has not been added or bundled in Workers; HON-209
  owns that gate.
- Browser-extension, Web, Desktop, mobile, CLI, localhost, custom-domain,
  staging, production, and authenticator compatibility remain unverified.
- TOTP interaction with the pinned client's unsupported WebAuthn two-factor
  continuation requires an explicit decision in HON-211.
- No real account, credential, authenticator, runtime binding, deployment, or
  production state was touched in this workflow.

## Reusable Follow-up

Use `results/01-current-auth-boundary.md`,
`results/02-pinned-client-contract.md`, and
`results/03-pinned-server-security-contract.md` as the acceptance baseline for
HON-208 through HON-214. Do not rerun the decomposition apply after child states
advance; its exact Todo snapshot is historical evidence.
