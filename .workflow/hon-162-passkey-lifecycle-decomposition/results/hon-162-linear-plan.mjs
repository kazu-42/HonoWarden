const child = ({
  key,
  title,
  blockers = [],
  goal,
  scope,
  acceptance,
  rollback,
  evidence,
}) => ({
  key,
  title,
  blockers,
  goal,
  scope,
  acceptance,
  rollback,
  evidence,
})

export const plan = {
  version: 1,
  createdAt: '2026-07-19',
  sourcePins: {
    clients: {
      ref: 'web-v2026.6.1',
      commit: '39f07436ca60e3f25eac47777671754f288a98f1',
    },
    server: {
      ref: 'v2026.6.1',
      commit: 'a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
    },
    verifier: {
      package: '@simplewebauthn/server',
      reviewedVersion: '13.3.2',
      reviewedAt: '2026-07-19',
    },
  },
  linear: {
    teamId: '6d2d2f00-2bf6-4dde-bfee-5414946b06ee',
    projectId: '8a2a2aea-a64e-4528-b07b-0cd822b66482',
    projectName: 'HonoWarden Post-Alpha Roadmap',
    childStateId: '25d6b2f5-fa8a-4a5a-9194-5b67f66afb2a',
    childStateName: 'Todo',
    parentStateId: 'afa8fa07-abd6-4aaa-99f7-fb77ee41cb33',
    parentStateName: 'In Progress',
    priority: 0,
  },
  parent: {
    id: '4268b7f2-4c6f-43fc-9266-356661b748f8',
    identifier: 'HON-162',
    title: 'Account slice A4: WebAuthn and passkey credential lifecycle',
  },
  children: [
    child({
      key: 'AUTH-4A',
      title: 'WebAuthn A4.1: protocol, RP/origin, and recovery contract',
      goal: 'Freeze the HonoWarden WebAuthn wire, trust, vault-key, and recovery boundaries before any credential or challenge state can be written.',
      scope: [
        'Add ADR 0012, a WebAuthn threat model, and a pinned wire/state contract covering the official anonymous assertion-options route, webauthn token grant, authenticated credential routes, PRF key-set semantics, and HonoWarden-only rename behavior.',
        'Add a default-off runtime policy for HONOWARDEN_WEBAUTHN_ENABLED, canonical HONOWARDEN_WEBAUTHN_RP_ID, and an exact HTTPS origin allowlist. Allow localhost HTTP only under an explicit local-development policy; never derive trust from Host, Origin, CF-Connecting-IP, or forwarded headers.',
        'Specify challenge purpose/account/RP/origin/expiry/single-use invariants, enumeration-safe external errors, sign-counter and backup-state rules, recent-proof requirements, security-stamp/session effects, last-recovery behavior, redaction, audit, retention, and rollback.',
        'Keep routes absent and capability advertising false while only the contract and policy parser exist.',
      ],
      acceptance: [
        'Focused tests prove disabled-by-default behavior and fail-closed rejection of enabled-but-incomplete, wildcard, credential-bearing, path-bearing, query-bearing, cross-RP, non-HTTPS production, and malformed origin/RP settings.',
        'The contract distinguishes assertion authentication from PRF-backed Vault unlock and forbids PRF results, raw challenges, credential public keys, user handles, and authenticator payloads in logs, audit context, fixtures, or evidence.',
        'The ADR assigns migration 0015 and all credential/challenge writes exclusively to AUTH-4B and keeps source capability, environment activation, official-client evidence, and compatibility promotion separate.',
      ],
      rollback:
        'Code rollback removes only unused default-off policy parsing and documentation. No schema, credential, challenge, session, user, route, binding, or runtime capability is created by this child.',
      evidence:
        'Record pinned source paths, policy red/green tests, type/lint/format/full gates, threat review, independent review, PR/CI, merge/main readback, and exact Linear checkpoint. Do not use a real origin, account, authenticator, credential, key, or challenge.',
    }),
    child({
      key: 'AUTH-4B',
      title: 'WebAuthn A4.2: D1 credential/challenge state and verifier core',
      blockers: ['AUTH-4A'],
      goal: 'Provide the forward-only persistence and maintained verification core required by every WebAuthn ceremony without exposing a route.',
      scope: [
        'Add migration 0015 with user-owned credentials and purpose-bound challenges. Store credential ID, COSE public key, user handle, sign count, transports, credential type, AAGUID, discoverable/backup eligibility/state, PRF state and encrypted key triple, name, revision/last-used timestamps, plus challenge hash, purpose, account, RP ID, origin-policy version, expiry, and consumed state.',
        'Integrate a pinned maintained @simplewebauthn/server verifier compatible with Cloudflare Workers; do not implement CBOR, COSE, attestation, authenticator-data, client-data, signature, RP, origin, or user-verification parsing locally.',
        'Implement repository transitions for bounded issue/list/read/create, exact-owner lookup, atomic single-use challenge consumption, successful-only counter/backup-state update, rename metadata, delete, and bounded expiry cleanup.',
        'Preserve valid zero counters for synced passkeys and reject actual positive regressions without manufacturing a counter.',
      ],
      acceptance: [
        'Migration and repository tests cover foreign-owner isolation, duplicate credential IDs, challenge purpose/account/RP/origin mismatch, expiry, replay, concurrent consume, malformed encodings, positive counter regression, valid zero-counter backup credentials, and failed-verification no-write behavior.',
        'A Workers dry-run proves the exact verifier dependency bundles in the target runtime, and package audit plus lockfile policies pass.',
        'Scheduled cleanup deletes only bounded expired/consumed challenge slices and does not remove active credentials or unrelated auth state.',
      ],
      rollback:
        'Use a forward-only additive migration. Code rollback leaves inert credential/challenge tables in place, disables all consumers, and preserves rows for reviewed recovery; never down-migrate or delete user authentication state automatically.',
      evidence:
        'Record dependency/version review, migration integrity, repository race tests, Workers dry-run, focused/full gates, security review, PR/CI, merge/main readback, and exact Linear state using synthetic byte fixtures only.',
    }),
    child({
      key: 'AUTH-4C',
      title: 'WebAuthn A4.3: authenticated enrollment and credential inventory',
      blockers: ['AUTH-4B'],
      goal: 'Implement default-off, authenticated registration and owner-only credential inventory against the pinned official Web client contract.',
      scope: [
        'Implement POST /api/webauthn/attestation-options, POST /api/webauthn, and GET /api/webauthn with the pinned request/response envelopes, resident-key and user-verification requirements, no attestation conveyance, five-credential limit, exact exclude list, and seven-minute registration challenge.',
        'Accept only verified current account proof supported by HonoWarden, validate name and optional encrypted PRF key triple bounds, and expose only owner-safe row ID, name, PRF status, encrypted user/public keys, and revision metadata.',
        'Persist no registration state until maintained-library attestation verification, exact account/purpose/RP/origin challenge consumption, and credential uniqueness all succeed in one recoverable transition.',
        'Emit secret-safe success/failure audit events and apply authenticated quota policy without recording credential IDs, user handles, public keys, AAGUID, challenge bytes, or raw payloads.',
      ],
      acceptance: [
        'Official-shaped fixtures cover options, successful create/list, duplicate and sixth credential, stale/replayed/foreign challenge, RP/origin mismatch, malformed response, missing UV, secret-proof failure, foreign account isolation, PRF status, and no partial row on failure.',
        'Routes remain typed unavailable when the runtime policy is disabled or incomplete and do not alter /api/config support claims.',
        'Credential creation cannot replace an existing credential or key set and list output never leaks verifier material or another account row.',
      ],
      rollback:
        'Disable registration routes while retaining verified credential rows. Existing password/TOTP/auth-request login and Vault sync remain unchanged; no credential row is deleted by code rollback.',
      evidence:
        'Record official-shaped fixtures, redacted audit/quota assertions, focused/full gates, independent security/compatibility review, PR/CI, merge/main readback, and exact Linear checkpoint. No hardware authenticator is used in this child.',
    }),
    child({
      key: 'AUTH-4D',
      title:
        'WebAuthn A4.4: assertion grant, device session, and PRF Vault unlock',
      blockers: ['AUTH-4B'],
      goal: 'Implement the anonymous discoverable assertion and webauthn token grant while preserving device sessions and the client-side PRF Vault-key boundary.',
      scope: [
        'Implement GET /identity/accounts/webauthn/assertion-options and grant_type=webauthn on POST /identity/connect/token with opaque challenge token, JSON deviceResponse, exact device fields, required user verification, generic failures, and persistent anonymous quotas.',
        'Resolve the account only from the verified user handle and asserted owner credential, atomically consume the authentication challenge, verify RP/origin/signature/counter/backup state, then create the existing device/refresh session and a distinct webauthn access-token auth method.',
        'Return UserDecryptionOptions.WebAuthnPrfOption only for the exact asserted credential when its encrypted key triple is complete. Never accept or return PRF output, and do not claim passwordless Vault unlock for Supported or Unsupported PRF states.',
        'Define TOTP interaction explicitly for this pinned client, which cannot complete a WebAuthn two-factor continuation, without weakening the existing password-plus-TOTP path.',
      ],
      acceptance: [
        'Fixtures cover successful grant/session/refresh, malformed token/device response, unknown user handle/credential, foreign credential, replay, expiry, RP/origin/signature/UV failure, positive counter regression, valid synced zero counter, disabled user, revoked device behavior, quota denial, and database failure.',
        'Concurrent assertion attempts for one challenge produce exactly one session, failed assertions update neither counter nor device/refresh state, and all external identity failures remain enumeration-safe.',
        'PRF-enabled fixture login returns only the asserted credential key set and a client-shaped decryption option; non-enabled credentials authenticate without fabricating a Vault key or compatibility claim.',
      ],
      rollback:
        'Disable the webauthn grant and anonymous options route. Revoke only synthetic evidence sessions during test cleanup; retained credential rows remain inert and password/TOTP/auth-request login remains authoritative.',
      evidence:
        'Record official token-form and response fixtures, replay/race/quota/audit tests, focused/full gates, independent security/compatibility review, PR/CI, merge/main readback, and exact Linear checkpoint without a real account or authenticator.',
    }),
    child({
      key: 'AUTH-4E',
      title:
        'WebAuthn A4.5: PRF enablement, rename, delete, and session revocation',
      blockers: ['AUTH-4C', 'AUTH-4D'],
      goal: 'Complete credential management and recovery-safe revocation after enrollment and assertion paths are available.',
      scope: [
        'Implement POST /api/webauthn/assertion-options and PUT /api/webauthn for assertion-proven PRF encrypted key-set enablement using the pinned official contract and a purpose-scoped 17-minute maximum multi-ceremony challenge.',
        'Implement owner-only HonoWarden rename and pinned POST /api/webauthn/{id}/delete with verified current proof, bounded names, exact credential ownership, audit events, and stable not-found behavior.',
        'Require a usable password recovery path before deletion, reject removal that violates the configured last-method policy, and on successful delete rotate the account security stamp and revoke all refresh sessions in one recoverable transition.',
        'Keep PRF key rotation generation-safe so stale assertions cannot overwrite a newer encrypted key set.',
      ],
      acceptance: [
        'Tests cover PRF enable success, unsupported authenticator, incomplete/invalid encrypted triples, stale/replayed/foreign assertion, generation race, rename bounds/ownership, delete proof/ownership, last-method denial, and database rollback.',
        'Rename does not revoke sessions; successful delete invalidates old access tokens through security-stamp readback and revokes refresh tokens without deleting other credentials or Vault data.',
        'No management response or audit context exposes credential ID bytes, public keys, encrypted private key, user handle, challenge, or raw authenticator payload.',
      ],
      rollback:
        'Disable PRF update, rename, and delete routes while preserving rows and current sessions. A completed security-stamp rotation is not rolled back; users recover through the retained password path and sign in again.',
      evidence:
        'Record official and HonoWarden-extension fixtures, transaction/failure-injection readback, session invalidation tests, focused/full gates, independent review, PR/CI, merge/main readback, and exact Linear checkpoint.',
    }),
    child({
      key: 'AUTH-4F',
      title: 'WebAuthn A4.6: default-off compatibility and rollback gate',
      blockers: ['AUTH-4E'],
      goal: 'Integrate the complete source capability behind one fail-closed activation boundary without claiming live client support.',
      scope: [
        'Wire the RP/origin policy, routes, quotas, audit, scheduled cleanup, config/profile/decryption responses, environment documentation, fixture replay, release gate, and rollback packet as one default-off integration surface.',
        'Keep partially configured policy unavailable and no-store, distinguish source-ready from runtime-enabled state, and preserve exact unsupported behavior in every environment where the feature is off.',
        'Add compatibility fixtures for pinned Web/browser-extension/Desktop request envelopes and explicitly retain CLI/mobile/native/hardware surfaces as unverified until evidence exists.',
        'Produce a staging activation and rollback packet that names bindings, migration/readback, cleanup, observability, synthetic-account isolation, stop conditions, and credential/session cleanup without executing it.',
      ],
      acceptance: [
        'Disabled and incomplete-policy regression tests prove no route or config drift; enabled synthetic fixtures pass registration, list, assertion grant, PRF response, rename, delete, security-stamp invalidation, quota, audit, and cleanup end to end.',
        'The full release gate, dependency audit, Workers dry-run, migration integrity, brand scan, compatibility suite, and independent security/compatibility reviews pass.',
        'Docs state source-ready only and do not promote browser, desktop, mobile, CLI, custom-domain, staging, or production compatibility before live evidence.',
      ],
      rollback:
        'The operator rollback packet disables one feature switch first, verifies typed unavailability, preserves credential rows, retains password login, and leaves migration 0015 intact. Runtime execution remains a separate approval gate.',
      evidence:
        'Record complete source gates, fixture matrix, generated activation/rollback packet, independent review, PR/CI, merge/main readback, and exact Linear checkpoint. Do not mutate staging or production in this child.',
    }),
    child({
      key: 'AUTH-4G',
      title:
        'WebAuthn A4.7: staged authenticator evidence and capability promotion',
      blockers: ['AUTH-4F'],
      goal: 'Prove the source capability with a synthetic account and supported authenticator before any compatibility or parent completion claim.',
      scope: [
        'After an explicit runtime approval, apply migration 0015 and the exact RP/origin bindings in staging, verify health/readback, and enroll only a dedicated synthetic platform or hardware authenticator through an isolated official pinned client profile.',
        'Exercise enrollment, credential list, PRF status, clean WebAuthn login, Vault unlock where PRF is available, refresh, rename, delete, old-session rejection, password recovery, replay/RP/origin negative cases, audit, quota, retention, and rollback.',
        'Run browser-extension and Web evidence separately. Treat Desktop, mobile, CLI, custom-domain, and production support as separate follow-ups unless each exact host is exercised.',
        'Remove synthetic credentials/sessions/account and test policy after evidence, read back cleanup, then promote only the proven compatibility rows and close HON-162 bottom-up.',
      ],
      acceptance: [
        'A supported authenticator completes the approved staging path with redacted evidence, and negative replay/RP/origin/session tests fail closed without exposing identity or credential material.',
        'Rollback disables new ceremonies while password recovery remains usable; retained migration/rows are reviewed, synthetic account and credential cleanup are exact, and no production binding changes occur.',
        'Compatibility documentation names exact client version, host, origin class, authenticator class, timestamp, source SHA, deployment SHA, evidence level, limits, and unverified surfaces. HON-162 closes only after source merge, staging readback, cleanup, and child-state verification.',
      ],
      rollback:
        'Disable the staging feature switch, restore the prior binding set, verify typed route unavailability and password login, revoke synthetic sessions, remove only the synthetic account/credential under approved cleanup, and retain migration 0015.',
      evidence:
        'Record approval, redacted staging config/readback, official-client screenshots or structured evidence, audit/quota/retention readback, rollback and cleanup proof, compatibility diff, PR/CI if docs change, merge/main readback, and exact Linear bottom-up closeout.',
    }),
  ],
}

export function canonicalMarker(childDefinition) {
  return `HonoWarden HON-162 decomposition key: \`${childDefinition.key}\`.`
}

export function renderGuardedDescription(childDefinition) {
  return [
    '## Synchronization guard',
    '',
    'HON-162 child synchronization is in progress. Do not start or alter this issue until the complete hierarchy, dependency graph, and exact readback pass.',
    '',
    canonicalMarker(childDefinition),
  ].join('\n')
}

export function renderDescription(childDefinition, identifiers = {}) {
  const dependencyText =
    childDefinition.blockers.length === 0
      ? 'No blocking child relation. This is the first source child under HON-162.'
      : `Blocked by ${childDefinition.blockers
          .map((key) => identifiers[key] ?? key)
          .join(', ')} through explicit Linear relations.`

  return [
    '## Goal',
    '',
    childDefinition.goal,
    '',
    '## Scope',
    '',
    ...childDefinition.scope.map((item) => `* ${item}`),
    '',
    '## Acceptance criteria',
    '',
    ...childDefinition.acceptance.map((item) => `* ${item}`),
    '',
    '## Dependencies',
    '',
    dependencyText,
    '',
    '## Rollback and safety',
    '',
    childDefinition.rollback,
    '',
    '## Evidence',
    '',
    childDefinition.evidence,
    '',
    canonicalMarker(childDefinition),
  ].join('\n')
}
