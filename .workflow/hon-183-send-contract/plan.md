# HON-183 Send Slice S1 Contract

## Goal

Approve the cryptographic, public-token, storage, abuse, retention, rollback,
and compatibility contract required before any stateful Send route is enabled.
This slice establishes design and regression coverage plus narrow cache-header
hardening. The existing explicit `501` Send guards remain the runtime behavior;
no stateful Send route is added or enabled.

## Success Criteria

- Replace ADR 0003's permanent alpha exclusion with an accepted, sliced Send
  product-line decision while preserving the current guard until later slices
  satisfy their activation gates.
- Define the complete owner and public wire surface used by the pinned official
  clients, including owner CRUD, file upload, `send_access`, metadata access,
  and file-download authorization.
- Define a zero-knowledge boundary: the Worker never receives plaintext Send
  payloads or the URL-fragment decryption key.
- Define high-entropy public capability lookup, short-lived Send-scoped access
  tokens, credential verification, enumeration resistance, and atomic maximum
  access-count behavior.
- Define D1/R2 state, lifecycle transitions, generation-safe cleanup, object
  activation, retention, audit redaction, abuse controls, feature gating,
  observability, and rollback behavior.
- Keep email OTP explicit but deferred from the first stateful slice rather than
  silently implementing a partial authentication flow.
- Add regression tests that fail if the contract becomes incomplete or the
  current `501` guard/config boundary is removed early.
- Set `Cache-Control: no-store` on both config aliases and the shared unsupported
  `501` response so the current readiness signals match the accepted contract.

## Current Context

- ADR 0003 excludes Send/public sharing from the alpha scope and lists the
  minimum controls required for reconsideration.
- ADR 0009 and `src/app.ts` return explicit `501 unsupported_feature` responses
  for `/api/sends`, child routes, and `grant_type=send_access` after an optional
  global ingress quota check but before route-specific auth or Send storage work.
- `src/protocol/config.ts` advertises `send-enabled: false`.
- The official-client contract was audited at tag `web-v2026.6.1`, commit
  `39f07436ca60e3f25eac47777671754f288a98f1`.
- The official-server contract was audited at tag `v2026.6.1`, commit
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.

## Constraints

- Do not add migrations, repositories, stateful routes, public responses,
  object writes, token issuance, or runtime feature flags in HON-183.
- Do not change current-state or compatibility claims to present Send as
  implemented or verified.
- Do not expose provider branding or direct provider URLs in tracked artifacts;
  preserve only reproducible source pins and source paths.
- Infrastructure failures in future Send slices must fail loudly; partial D1/R2
  activation must fail closed.
- GitHub commit, push, PR, review comment, close, and merge remain explicit
  approval gates. Deploy, production data, DNS, bindings, secrets, and external
  contact are separately gated.

## Risks

- A route-shaped contract without concurrency semantics can overrun maximum
  access counts under parallel requests.
- A D1 row can become publicly visible before its R2 object is complete unless
  activation is generation-bound and explicit.
- Raw capability IDs, URL keys, passwords, OTPs, bearer tokens, download URLs,
  or recipient addresses can leak through app or platform logs.
- Distinguishable missing/expired/disabled/credential failures can turn the
  token endpoint into a capability enumeration oracle.
- A partial feature flag can advertise support while migrations, R2, cleanup,
  rate limits, or signing material are absent.
- An in-place D1 restore can rewind feature, kill-switch, and cleanup state
  together unless an out-of-band gate and activation epoch fail closed.

## Work Packets

- `01-contract-research`: pin and map the official wire/lifecycle contract and
  current HonoWarden guard boundary.
- `02-design-docs-tests`: add contract tests, replacement ADR, dedicated threat
  model, and protocol wire contract.
- `03-verification-linear`: run focused and broad gates, independent review,
  and exact managed Linear checkpoint readback.

## Verification

- `pnpm exec vitest run test/send-contract-docs.test.ts test/security-docs.test.ts test/compat/client-matrix.test.ts test/app.test.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm brand:scan`
- `pnpm release:gate -- --strict`
- `python3 .codex/skills/codex-dynamic-workflows/scripts/verify_workflow.py .workflow/hon-183-send-contract`
- `git diff --check`

## Reusable Artifacts

The accepted state machine and wire contract become the activation checklist
for HON-184 owner/text persistence, HON-185 public access, and later file-storage
and operational closeout slices.
