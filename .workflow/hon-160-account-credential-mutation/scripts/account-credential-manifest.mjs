const commonSafety =
  'Keep every new route default-off until its owning child is merged and reviewed. Fail unsupported or partially configured behavior explicitly. A committed credential generation is never rolled back by restoring an old hash or security stamp; recovery creates a new forward generation. Production activation, real-user mutation, credential rotation, destructive data changes, paid services, and third-party contact require separate approval.'

const commonEvidence =
  'Record pinned official-source paths, red/green focused tests, full repository gates, real local D1 transaction and rollback readback, independent review, PR/CI, merge/main readback, exact Linear state, and official-client synthetic evidence only where a compatibility claim is made. No real credentials, plaintext vault data, raw tokens, unwrapped keys, personal identities, or private provider payloads may enter evidence.'

export const accountCredentialPlan = {
  parentIdentifier: 'HON-160',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  priority: 0,
  sourcePins: {
    clients: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
    server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
  },
  issues: [
    {
      key: 'AUTH-2A',
      title:
        'Account A2a: credential mutation foundation and security-stamp rotation',
      stateType: 'started',
      blockers: [],
      goal: 'Create one guarded D1 credential-generation primitive and expose explicit security-stamp rotation without enabling password, KDF, or key mutation prematurely.',
      scope: [
        'Parse and validate current client-derived authentication proof plus the expected user security-stamp generation; never receive a plaintext master password.',
        'Atomically rotate security stamp and account revision, revoke every active device/refresh session, and persist one redacted required audit event.',
        'Expose `POST /api/accounts/security-stamp` behind recent password authentication and exact current-hash verification; leave password, KDF, and key routes absent.',
      ],
      acceptance: [
        'Invalid hash, stale stamp, disabled user, malformed input, refresh/auth-request-issued access token, and concurrent stale mutation change no credential or session state and reveal no account detail.',
        'A user update, session revocation, or audit insert failure rolls the complete D1 batch back and cannot emit a false success response or success log.',
        'Old access and refresh tokens fail after success, while a new password login can recreate its device session without restoring any old token.',
        'Focused/fake-D1 and real local D1 tests, full host gates, independent review, reviewed merge, and exact Linear readback pass before Done.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
    {
      key: 'AUTH-2B',
      title: 'Account A2b: verify-password and existing master-password change',
      stateType: 'unstarted',
      blockers: ['AUTH-2A'],
      goal: 'Support current-password verification and existing-account master-password change using client-derived authentication and unlock data.',
      scope: [
        'Implement `POST /api/accounts/verify-password` and the pinned `POST /api/accounts/password` structured request contract, plus only the legacy variant required by a pinned supported client.',
        'Require current hash proof and matching authentication/unlock salt and KDF; password change cannot alter the stored KDF generation.',
        'Commit new authentication hash, opaque wrapped user key, revision, security stamp, session revocation, and required audit through AUTH-2A.',
      ],
      acceptance: [
        'Mixed request variants, salt/KDF drift, invalid current hash, stale generation, oversized opaque values, and database failure leave the old password and sessions unchanged.',
        'After success the old password, access tokens, and refresh tokens fail; the new password can log in, unlock locally, and sync the unchanged encrypted vault.',
        'Password-hint behavior is either persisted through an unambiguous reviewed migration or explicitly rejected before mutation; it is never silently discarded.',
        'Focused/full tests, independent review, official-client synthetic lifecycle, reviewed merge, and exact Linear readback pass before Done.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
    {
      key: 'AUTH-2C',
      title: 'Account A2c: PBKDF2 and Argon2id KDF mutation',
      stateType: 'unstarted',
      blockers: ['AUTH-2A'],
      goal: 'Change an existing account between accepted PBKDF2-SHA256 and Argon2id configurations without producing an undecryptable credential generation.',
      scope: [
        'Implement `POST /api/accounts/kdf` with old-hash proof, unchanged account salt, and identical new authentication/unlock KDF data.',
        'Enforce pinned inclusive bounds: PBKDF2 iterations 600000..2000000; Argon2id iterations 2..10, memory 15..1024 MiB, and parallelism 1..16.',
        'Project the stored KDF type and parameters consistently through prelogin, password/refresh token responses, profile, and sync.',
      ],
      acceptance: [
        'Every boundary and just-outside value, missing Argon2 parameter, unknown algorithm, mixed KDF generation, salt drift, stale mutation, and D1 failure is fail-closed and state-free.',
        'Unknown-account prelogin remains enumeration-resistant while known allowed accounts receive their exact stored KDF configuration.',
        'Old sessions and old KDF login fail after success; a clean pinned client derives the new master key, logs in, unlocks, and syncs.',
        'Focused/full tests, real local D1 readback, independent review, reviewed merge, and exact Linear evidence pass before Done.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
    {
      key: 'AUTH-2D',
      title: 'Account A2d: account keypair read and one-time initialization',
      stateType: 'unstarted',
      blockers: ['AUTH-2A'],
      goal: 'Support official account-key reads and one-time opaque public/wrapped-private key initialization without permitting replacement through the initialization route.',
      scope: [
        'Implement `GET /api/accounts/keys` and the pinned `POST /api/accounts/keys` request/response envelope for supported account encryption state.',
        'Accept only complete bounded opaque key material; reject partial state, conflicting replacement, malformed variants, and unsupported V2 fields before mutation.',
        'Make an exact idempotent replay safe while routing any true replacement to AUTH-2E user-key rotation.',
      ],
      acceptance: [
        'Missing, cross-user, disabled, partial-existing, malformed, oversized, and different-existing keypair cases cannot overwrite or disclose account cryptographic state.',
        'Initial creation, security-stamp/revision policy, session effects, and required audit are atomic and independently read back.',
        'GET/profile/token/sync projections agree on the same public and wrapped-private values without exposing an unwrapped private key.',
        'Focused/full tests, independent review, pinned-client synthetic evidence, reviewed merge, and exact Linear readback pass before Done.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
    {
      key: 'AUTH-2E',
      title: 'Account A2e: atomic user-key rotation across personal vault data',
      stateType: 'unstarted',
      blockers: ['AUTH-2B', 'AUTH-2D'],
      goal: 'Rotate the user key, password authentication/unlock generation, account keypair, and every supported personal-vault encrypted record as one validated transition.',
      scope: [
        'Implement the pinned `POST /api/accounts/key-management/rotate-user-account-keys` contract for personal folders, ciphers, account keys, and supported device-key data.',
        'Validate the complete exact record-id/revision set before write; no foreign, deleted, duplicate, missing, stale, or partial payload can commit.',
        'Reject non-empty Send, Emergency Access, organization recovery, WebAuthn, TDE, or Key Connector rotation data before any supported write until their owning slices merge.',
      ],
      acceptance: [
        'All opaque encrypted records, authentication/unlock data, keypairs, stamp, revision, sessions, and required audit commit or roll back together under concurrent mutation.',
        'Attachment-bearing cipher behavior is explicit and cannot orphan R2 objects or accept a foreign attachment relationship.',
        'Old user-key/password/session generations fail after success while a clean client unlocks every rotated synthetic personal record.',
        'Focused/full tests, real D1 abort/concurrency proof, independent review, reviewed merge, and exact Linear readback pass before Done.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
    {
      key: 'AUTH-2F',
      title:
        'Account A2f: official-client credential-mutation and rollback closeout',
      stateType: 'unstarted',
      blockers: ['AUTH-2B', 'AUTH-2C', 'AUTH-2D', 'AUTH-2E'],
      goal: 'Close the existing-account credential program on one reviewed commit with truthful official-client evidence, operations, and forward-recovery behavior.',
      scope: [
        'Run password verification/change, PBKDF2 and Argon2id KDF change, keypair initialization/read, user-key rotation, restart, login, unlock, sync, and old-generation rejection in isolated official clients.',
        'Reconcile route inventory, compatibility matrix, current-state/security docs, audit/retention, backup/restore, disable behavior, and operator recovery instructions.',
        'Keep initial password setting under HON-159 and every unsupported external product rotation field typed and state-free.',
      ],
      acceptance: [
        'One pinned synthetic lifecycle proves old password/KDF/tokens/keys fail and the new generation decrypts locally after restart without data loss or cross-account disclosure.',
        'Backup/restore and feature-disable evidence cannot resurrect old sessions or credential generations; recovery is a new forward rotation.',
        'Compatibility levels distinguish fixture, local live smoke, staging, and production and never promote from API-only evidence.',
        'Full regression, independent security review, reviewed merge/main readback, child closeouts, and exact parent Linear evidence pass before HON-160 can close.',
      ],
      safety: commonSafety,
      evidence: commonEvidence,
    },
  ],
}

export function validatePlan(plan) {
  if (!plan || plan.parentIdentifier !== 'HON-160') {
    throw new Error('HON-160 parent is required')
  }
  if (!Array.isArray(plan.issues) || plan.issues.length !== 6) {
    throw new Error('exactly six child issues are required')
  }

  const keys = new Set()
  const titles = new Set()
  for (const issue of plan.issues) {
    if (!issue.key || keys.has(issue.key)) {
      throw new Error(`duplicate or empty key: ${issue.key}`)
    }
    if (!issue.title || titles.has(issue.title)) {
      throw new Error(`duplicate or empty title: ${issue.title}`)
    }
    if (
      !issue.goal ||
      !Array.isArray(issue.scope) ||
      issue.scope.length < 2 ||
      !Array.isArray(issue.acceptance) ||
      issue.acceptance.length < 2 ||
      !issue.safety ||
      !issue.evidence
    ) {
      throw new Error(`incomplete issue contract: ${issue.key}`)
    }
    if (!['started', 'unstarted'].includes(issue.stateType)) {
      throw new Error(`unsupported state type for ${issue.key}`)
    }
    keys.add(issue.key)
    titles.add(issue.title)
  }

  for (const issue of plan.issues) {
    for (const blocker of issue.blockers) {
      if (!keys.has(blocker)) {
        throw new Error(`unknown blocker ${blocker} for ${issue.key}`)
      }
      if (blocker === issue.key) {
        throw new Error(`self blocker: ${issue.key}`)
      }
    }
  }

  assertAcyclic(plan.issues)
  const started = plan.issues
    .filter((issue) => issue.stateType === 'started')
    .map((issue) => issue.key)
  if (started.length !== 1 || started[0] !== 'AUTH-2A') {
    throw new Error('exactly AUTH-2A must start')
  }

  const relationCount = plan.issues.reduce(
    (total, issue) => total + issue.blockers.length,
    0,
  )
  if (relationCount !== 9) {
    throw new Error(
      `exactly nine block relations are required, got ${relationCount}`,
    )
  }

  return plan
}

export function summarizePlan(plan) {
  validatePlan(plan)
  return {
    status: 'valid',
    parent: plan.parentIdentifier,
    issueCount: plan.issues.length,
    startedCount: plan.issues.filter((issue) => issue.stateType === 'started')
      .length,
    blockRelationCount: plan.issues.reduce(
      (total, issue) => total + issue.blockers.length,
      0,
    ),
    sourcePins: plan.sourcePins,
  }
}

export function renderChildDescription(issue, identifiers) {
  const dependencies =
    issue.blockers.length === 0
      ? 'No blocking child relation is required. This is the first implementation slice under HON-160.'
      : `Blocked by ${issue.blockers
          .map((key) => identifiers[key] ?? key)
          .join(', ')} through explicit Linear relations.`

  return [
    '## Goal',
    '',
    issue.goal,
    '',
    '## Scope',
    '',
    ...issue.scope.map((item) => `* ${item}`),
    '',
    '## Acceptance criteria',
    '',
    ...issue.acceptance.map((item) => `* ${item}`),
    '',
    '## Dependencies',
    '',
    dependencies,
    '',
    '## Rollback and safety',
    '',
    issue.safety,
    '',
    '## Evidence',
    '',
    issue.evidence,
    '',
    canonicalMarker(issue),
  ].join('\n')
}

export function renderGuardedDescription(issue) {
  return [
    '## Synchronization guard',
    '',
    'HON-160 decomposition is being synchronized. Do not start or mutate this child until parent, project, state, dependency relations, and canonical descriptions all pass exact readback.',
    '',
    canonicalMarker(issue),
  ].join('\n')
}

export function renderParentDescription(identifiers) {
  const id = (key) => identifiers[key] ?? key
  return [
    '## Goal',
    '',
    'Implement the existing-account credential mutation lifecycle without exposing plaintext secrets, splitting cryptographic generations, or leaving old sessions valid.',
    '',
    '## Scope and ownership',
    '',
    '* Cover password verification/change, PBKDF2 and Argon2id KDF change, security-stamp rotation, account keypair initialization/read, and atomic user-key rotation.',
    '* HON-159 owns initial password setting for a passwordless or invite-created account. HON-160 does not invent TDE, Key Connector, SSO, or organization-recovery account states.',
    '* Client-derived authentication hashes and wrapped/opaque encrypted material are the only secret-bearing inputs; the server never receives plaintext master passwords or unwrapped user keys.',
    '',
    '## Child execution map',
    '',
    `* ${id('AUTH-2A')}: credential mutation foundation and explicit security-stamp rotation.`,
    `* ${id('AUTH-2B')}: password verification and change for an existing password-bearing account.`,
    `* ${id('AUTH-2C')}: bounded PBKDF2 and Argon2id KDF mutation plus all outward projections.`,
    `* ${id('AUTH-2D')}: account keypair read and one-time initialization.`,
    `* ${id('AUTH-2E')}: atomic user-key rotation across supported personal-vault data.`,
    `* ${id('AUTH-2F')}: official-client lifecycle, rollback, compatibility, and parent closeout.`,
    '',
    '## Dependency graph',
    '',
    `${id('AUTH-2A')} -> ${id('AUTH-2B')}, ${id('AUTH-2C')}, ${id('AUTH-2D')}; ${id('AUTH-2B')} + ${id('AUTH-2D')} -> ${id('AUTH-2E')}; ${id('AUTH-2B')} + ${id('AUTH-2C')} + ${id('AUTH-2D')} + ${id('AUTH-2E')} -> ${id('AUTH-2F')}.`,
    '',
    'HON-160 -> HON-164 remains the external account-lifecycle gate. HON-160 closes only after all six children are reviewed, merged, evidenced, and Done.',
    '',
    '## Cross-slice invariants',
    '',
    '* Authentication and unlock data use the same salt and KDF generation. Password change keeps KDF unchanged; KDF change validates pinned ranges.',
    '* Credential state, wrapped user key, account keys, security stamp, revision, active-session revocation, and required audit commit or fail together for each owning mutation.',
    '* Old access and refresh tokens fail after generation rotation. Recovery creates a new forward generation and never restores an old hash or stamp.',
    '* Unsupported non-empty product rotation payloads fail before any supported write; no route or feature flag implies unsupported capability.',
    '',
    '## Evidence and closeout',
    '',
    'Each child records pinned official source, focused/full tests, real local D1 rollback and concurrency evidence, independent review, PR/CI, merge/main readback, exact Linear state, and synthetic official-client evidence at the precise compatibility level claimed. No production activation or real-user credential mutation is part of source completion.',
    '',
    'HonoWarden capability roadmap key: `AUTH-2`.',
  ].join('\n')
}

export function renderDecompositionCheckpoint(identifiers) {
  const id = (key) => identifiers[key] ?? key
  return [
    '<!-- honowarden-managed:HON-160:decomposition-checkpoint -->',
    '',
    '## HON-160 decomposition checkpoint',
    '',
    'HON-160 is In Progress for reviewed planning and implementation of the first bounded child. The existing-account credential lifecycle is split into six one-PR slices with nine explicit dependency relations.',
    '',
    'Execution state:',
    '',
    `- ${id('AUTH-2A')} is In Progress for the migration-free credential mutation and security-stamp foundation.`,
    `- ${id('AUTH-2B')} through ${id('AUTH-2F')} remain Todo behind their exact dependency gates.`,
    '- Initial password setting for a passwordless/invite-created account remains owned by HON-159.',
    '',
    'Pinned contract:',
    '',
    `- clients: ${accountCredentialPlan.sourcePins.clients}`,
    `- server: ${accountCredentialPlan.sourcePins.server}`,
    '- client-derived authentication hashes and opaque wrapped keys only; no plaintext master password reaches the server.',
    '',
    'Safety boundary:',
    '',
    'No product source, migration, runtime, or production state was changed by this decomposition checkpoint. No real user, credential, token, key, vault data, browser profile, simulator, or provider was used. GitHub publication remains a separate approval gate; deployment, production users/secrets/data, credential rotation, destructive changes, paid services, and third-party contact remain separately gated.',
  ].join('\n')
}

export function canonicalMarker(issue) {
  return `HonoWarden credential mutation key: \`${issue.key}\`.`
}

function assertAcyclic(issues) {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]))
  const visiting = new Set()
  const visited = new Set()

  const visit = (key) => {
    if (visiting.has(key)) {
      throw new Error(`blocker cycle includes ${key}`)
    }
    if (visited.has(key)) {
      return
    }
    visiting.add(key)
    for (const blocker of byKey.get(key).blockers) {
      visit(blocker)
    }
    visiting.delete(key)
    visited.add(key)
  }

  for (const issue of issues) {
    visit(issue.key)
  }
}
